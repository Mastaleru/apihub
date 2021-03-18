const { ALIAS_SYNC_ERR_CODE } = require('./strategies/FS');

function createHandler(server){

    return function  addAnchor(request, response, next) {


        // get the domain configuration based on the domain extracted from anchorId.
        const receivedDomain = require('./utils').getDomainFromKeySSI(request.params.anchorId);
        const domainConfig = require("./utils").getAnchoringDomainConfig(receivedDomain);
        if (!domainConfig)
        {
            console.log('Anchoring Domain not found : ', receivedDomain);
            return response.send(500);
        }
        //init will receive all the available context information : the whole strategy, body, anchorId from the query and the protocol
        let flow = $$.flow.start(domainConfig.type);
        flow.init(domainConfig, request.params.anchorId, request.body, server.rootFolder);

        // all the available information was passed on init.
        flow.addAlias(server, (err, result) => {
            if (err) {
                if (err.code === 'EACCES') {
                    return response.send(409);
                }
                else if (err.code === ALIAS_SYNC_ERR_CODE) {
                    // see: https://tools.ietf.org/html/rfc6585#section-3
                    return response.send(428);
                }
                else if (err.code === 403) {
                    return response.send(403)
                }

                return response.send(500);
            }

            response.send(201);
        });


    }
}




module.exports = createHandler;
