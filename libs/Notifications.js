const stateStorageFileName = 'queues.json';

function NotificationsManager(workingFolderPath, storageFolderPath) {
	const queues = {};
	const queueMessageLifeTimers = {};
	const subscribers = {};
	const cleanupInterval = 250; // ms
	const swarmUtils = require('swarmutils');

	this.createQueue = function (queueName, timeout, callback) {
		if (typeof timeout === 'function') {
			callback = timeout;
			//timeout = 30 * 1000; //number of seconds * ms
            timeout = 500; // ms
		}

		if (typeof queues[queueName] !== "undefined") {
			return callback({ message: 'Queue already exists.', statusCode: 409 });
		}

		createQueue(queueName, timeout, (err) => {
			if (err) {
				return callback(err);
			}

			try {
				if (typeof storageFolderPath !== 'undefined') {
					require('fs').mkdirSync(getQueueStoragePath(queueName), { recursive: true });
				}
			} catch (err) {
				return callback(err);
			}

			return callback();
		});
	}

	function createQueue(name, timeout, callback) {
		queues[name] = new swarmUtils.Queue();
		queueMessageLifeTimers[name] = timeout;
		if (callback) {
			saveState(callback);
		}
	}

	function getQueueStoragePath(queueName) {
		let path = swarmUtils.path;
		const opendsu = require("opendsu");
		const crypto = opendsu.loadAPI('crypto');
		if (queueName.indexOf(':') !== -1) {
			queueName = crypto.encodeBase58(queueName);
		}
		return path.join(storageFolderPath, queueName);
	}

	function deliverMessage(subs, message, callback) {
		let counter = 0;
		while (subs.length > 0) {
			let sub = subs.pop();
			try {
				sub(undefined, message);
				counter++;
			} catch (err) {
				//if something happens durring message delivery we will catch the error here
			}
		}
		callback(undefined, counter);
	}

	function storeMessage(queueName, message, callback) {
		let path = swarmUtils.path;
		let fileName = path.join(getQueueStoragePath(queueName), new Date().getTime());
		require('fs').writeFile(fileName, message, (err) => {
			if (err) {
				return callback(err);
			}
			return callback(undefined, fileName);
		});
	}

	function buildNotification(message, timestamp, filename, ttl) {
		return {
			filename,
			message,
			timeout: undefined,
			timestamp: timestamp ? timestamp : new Date().getTime(),
			ttl
		};
	}

	function addMessageToQueue(queueName, message, messageTTL, callback) {
		if (typeof messageTTL === 'function') {
			callback = messageTTL;
			messageTTL = undefined;
		}
		const notificationObject = buildNotification(message, undefined, undefined, messageTTL);
		const notificationLifeTimer = queueMessageLifeTimers[queueName];

		if(typeof queues[queueName] === "undefined"){
			return callback(new Error(`There is no queue called ${queueName}`));
		}

		queues[queueName].push(notificationObject);

		if (typeof storageFolderPath !== 'undefined') {
			return notificationObject.timeout = setTimeout(function () {
				//maybe we don't need to do this ... bur for safety reasons...
				for (let notification in queues[queueName]) {
					if (notification === notificationObject) {
						return;
					}
				}

				return storeMessage(queueName, message, (err, fileName) => {
					if (fileName) {
						notificationObject.filename = fileName;
					}
					callback(err);
				});
			}, notificationLifeTimer);
		}
        callback();
	}

	this.sendMessage = function (queueName, message, messageTTL, callback) {
		if (typeof messageTTL === 'function') {
			callback = messageTTL;
			messageTTL = undefined;
		}

		let subs = subscribers[queueName];
		//console.log('sub',queueName, subscribers[queueName])
		if (typeof subs !== 'undefined' && subs.length > 0) {
			return deliverMessage(subs, message, (err, counter)=>{
				if(err || counter === 0){
					return addMessageToQueue(queueName, message, messageTTL, callback);
				}
				return callback(err, counter);
			});
		}

		return addMessageToQueue(queueName, message, messageTTL, callback);
	}

	this.readMessage = function (queueName, callback) {
		if (typeof subscribers[queueName] === 'undefined') {
			subscribers[queueName] = [];
		}

		const subs = subscribers[queueName];
		subs.push(callback);

		const notificationObject = queues[queueName].pop();

		if (typeof notificationObject !== 'undefined' && notificationObject !== null) {
			deliverMessage(subs, notificationObject.message, (err, counter) => {
				if (counter > 0) {
					//message delivered... let's check if has a timer waiting to persist it
					if (typeof notificationObject.timeout !== 'undefined') {
						clearTimeout(notificationObject.timeout);
						return;
					}
					//message delivered... let's remove from storage if it was persisted
					if (typeof notificationObject.filename !== 'undefined') {
						try {
							require('fs').unlinkSync(notificationObject.filename);
						} catch (err) {
							console.log(err);
						}
					}
				}
			});
		}
	}

	function loadState(callback) {
		let state;

		try {
			state = require(path.join(workingFolderPath, stateStorageFileName));
		} catch (err) {
			return callback(err);
		}

		if (typeof state !== 'undefined') {
			for (let i = 0; i < state.queues.length; i++) {
				let queueName = state.queues[i];
				createQueue(queueName, state.timeouts[queueName]);
			}
		}

		callback(undefined, state);
	}

	function saveState(callback) {
		let state = {
			timeouts: queueMessageLifeTimers,
			queues: Object.keys(queues)
		}

		let fs = require('fs');
		let path = swarmUtils.path;

		fs.writeFile(path.join(workingFolderPath, stateStorageFileName), JSON.stringify(state, null, 4), callback);
	}

	/**
	 * Remove expired queued notifications
	 * TODO: Do cleanup in async batches in order to
	 * prevent hogging the event loop
	 */
	function startMQsgsCleanup() {
		setInterval(() => {
			const keys = Object.keys(queues);
			const now = new Date().getTime();

			for (const key of keys) {
				const queue = queues[key];

				for (const msg of queue) {
					if (!msg.ttl) {
						continue;
					}
					const elapsed = now - msg.timestamp;
					// Remove expired message
					if (elapsed >= msg.ttl) {
						queue.remove(msg);
					}
				}
			}
		}, cleanupInterval);

	}

	this.initialize = function (callback) {
		let fs = require('fs');
		let path = swarmUtils.path;

		//if it's the first time we need to ensure that the working folder exists
		if (!fs.existsSync(workingFolderPath)) {
			fs.mkdirSync(workingFolderPath, { recursive: true });
		}

		startMQsgsCleanup();

		loadState((err, state) => {
			if (typeof storageFolderPath === 'undefined') {
				return callback();
			}

			//if it's the first time we need to ensure that the storage folder exists
			if (!fs.existsSync(storageFolderPath)) {
				fs.mkdirSync(storageFolderPath, { recursive: true });
			}

			//if is our first boot using a specific folder there is no state to be loaded
			if (typeof state === 'undefined') {
				return callback();
			}

			for (let i = 0; i < state.queues.length; i++) {
				let queueName = state.queues[i];
				let queueStoragePath = path.join(storageFolderPath, queueName);
				fs.readdir(queueStoragePath, (err, messages) => {
					if (err) {
						return callback(err);
					}

					messages.sort(function (a, b) {
						return Number(a) - Number(b);
					});

					for (let i = 0; i < messages.length; i++) {
						let messageTimestamp = messages[i];
						let messageStoragePath = path.join(queueStoragePath, messageTimestamp);
						queues[queueName].push(buildNotification(fs.readFileSync(messageStoragePath), messageTimestamp, messageStoragePath));
					}
				});
			}
		});
	}
}

module.exports = {
	getManagerInstance: function (workingFolderPath, storageFolderPath, callback) {
		if (typeof storageFolderPath === 'function') {
			callback = storageFolderPath;
			storageFolderPath = undefined;
		}

		let manager = new NotificationsManager(workingFolderPath, storageFolderPath);
		manager.initialize((err) => {
			callback(err, manager);
		});
	}
};
