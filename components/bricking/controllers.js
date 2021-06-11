
function createHandlerUploadBrick(server)
{
  return function uploadBrick(request, response, next) {
      const brickDomain = request.params.domain;
      const domainConfig = require('./utils/index').getBricksDomainConfigByDomain(brickDomain);
      if (!domainConfig)
      {
          console.log('Brick Domain not found : ', request.params.domain);
          return response.send(500);
      }

      const flow = $$.flow.start('BricksManager');
      flow.init(domainConfig, brickDomain, server.rootFolder);

      flow.write(request, (err, result) => {
          if (err) {
              return response.send(err.code === 'EACCES' ? 409 : 500);
          }

          response.send(201, result);
      });
  }

}

function createHandlerDownloadBrick(server)
{
    return function downloadBrick(request, response, next) {
        response.setHeader('content-type', 'application/octet-stream');
        response.setHeader('Cache-control', 'max-age=31536000'); // set brick cache expiry to 1 year
        const brickDomain = request.params.domain;
        const domainConfig = require('./utils/index').getBricksDomainConfigByDomain(brickDomain);
        if (!domainConfig)
        {
            console.log('Brick Domain not found : ', request.params.domain);
            return response.send(500);
        }

        const flow = $$.flow.start('BricksManager');
        flow.init(domainConfig,brickDomain,server.rootFolder);

        flow.read(request.params.hashLink, response, (err, result) => {
            if (err) {
                console.log("Brick not found ", request.params.hashLink);
                return response.send(404, 'Brick not found');
            }

            response.send(200);
        });
    }
}

function createHandlerDownloadMultipleBricks(server)
{
    return function downloadMultipleBricks(request, response, next) {
        response.setHeader('content-type', 'application/octet-stream');
        response.setHeader('Cache-control', 'max-age=31536000'); // set brick cache expiry to 1 year
        const brickDomain = request.params.domain;
        const domainConfig = require('./utils/index').getBricksDomainConfigByDomain(brickDomain);
        if (!domainConfig)
        {
            console.log('Brick Domain not found : ', request.params.domain);
            return response.send(500);
        }

        const flow = $$.flow.start('BricksManager');
        flow.init(domainConfig,brickDomain,server.rootFolder);
        flow.readMultipleBricks(request.query.hashes, response, (err, result) => {
            if (err) {
                return response.send(404, 'Brick not found');
            }

            response.send(200);
        });
    }
}


module.exports = { createHandlerUploadBrick, createHandlerDownloadBrick, createHandlerDownloadMultipleBricks };
