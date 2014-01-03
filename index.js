var path = require("path");
var fs = require("fs");
var async = require("async");

function writeFilesInto(dir, files, targetFile, thenDo) {
    var targetFilePath = path.join(dir, targetFile);
    var targetFileStream = fs.createWriteStream(targetFilePath);
    var writeFileTasks = files.map(function(file) {
        var fullPath = path.join(dir, file);
        return function(next) {
            targetFileStream.write('// ' + file + ':\n');
            var reader = fs.createReadStream(fullPath)
            reader.pipe(targetFileStream, {end: false});
            reader.on('end', function() {
                targetFileStream.write('\n\n\n');
                next();
            });
        }
    });
    
    async.series(writeFileTasks, function(err) {
        if (err) { console.log('error writing %s: %s', targetFilePath, err); }
        targetFileStream.end();
        thenDo(err, targetFilePath);
    });
}

function start(settings, thenDo) {
    var app = settings.app;
    (settings.routes || []).forEach(function(routeSettings) { 
        var r = routeSettings.route,
            baseDir = routeSettings.baseDirectory || process.cwd(),
            files = routeSettings.files || [];
        app.get(r, function(req, res) {
            // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
            var combinedFile = 'combined.js'
            writeFilesInto(baseDir, files, combinedFile, function(err, combinedFilePath) {
                if (err) { res.status(500).end(String(err)); return; }
                fs.createReadStream(combinedFilePath).pipe(res);
            })
            // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
        });
        thenDo && thenDo();
    });
}

function close(thenDo) {
    thenDo && thenDo();
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

module.exports = function(route, app, server) {
    start({route: route, app: app});
}

module.exports.start = start;
module.exports.close = close;
