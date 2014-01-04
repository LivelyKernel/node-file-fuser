var path   = require("path"),
    fs     = require("fs"),
    async  = require("async"),
    url    = require("url"),
    crypto = require("crypto");


function FileCombiner(options) {
  if (!options) throw new Error('FileCombiner requires config object');
  this.baseDirectory = options.baseDirectory;
  this.files = options.files;
  this.combinedFile = options.combinedFile;
  this.route = options.route;
}


FileCombiner.prototype.getCombinedFilePath = function() {
  return path.join(this.baseDirectory, this.combinedFile);
}

FileCombiner.prototype.getCombinedFileStream = function(thenDo) {
  var stream;
  try {
    stream = fs.createReadStream(this.getCombinedFilePath());
  } catch (e) { thenDo(e, stream); }
  thenDo(null, stream);
}

FileCombiner.prototype.writeFilesInto = function(baseDirectory, files, thenDo) {
  var targetFilePath   = this.getCombinedFilePath(),
    targetFileStream = fs.createWriteStream(targetFilePath),
    writeFileTasks   = files.map(function(file) {
      var fullPath = path.join(baseDirectory, file);
      return function(next) {
        targetFileStream.write('// ' + file + ':\n');
        var reader = fs.createReadStream(fullPath)
        reader.pipe(targetFileStream, {end: false/*don't close target stream*/});
        reader.on('end', function() {
          targetFileStream.write('\n\n\n');
          next();
        });
      }
    });

  async.series(writeFileTasks, function(err) {
    if (err) { console.log('error writing %s: %s', targetFilePath, err); }
    targetFileStream.end();
    thenDo(err);
  });
}

FileCombiner.prototype.checkIfCombinedFilesAreUpToDate = function(thenDo) {
  thenDo(null, false);
}

FileCombiner.prototype.streamCombinedFile = function(thenDo) {
  var self = this;
  self.checkIfCombinedFilesAreUpToDate(function(err, areUpToDate) {
    if (err) { thenDo(err, null); return; }
    else if (areUpToDate) self.getCombinedFileStream(thenDo);
    else self.writeFilesInto(self.baseDirectory, self.files, function(err, combinedFileName) {
      if (err) { thenDo(err, null); return; }
      self.getCombinedFileStream(thenDo);
    });
  })
}

FileCombiner.prototype.computeHash = function(combinedFileStream, thenDo) {
  var md5sum = crypto.createHash('md5'), hash;
  md5sum.setEncoding('hex');
  md5sum.on('data', function(d) {hash = String(d); });
  md5sum.on('error', function(err) { thenDo(err, null); });
  md5sum.on('end', function() { thenDo(null, hash); });
  combinedFileStream.pipe(md5sum);
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// http interface
FileCombiner.prototype.processJSRequest = function(req, res) {
  this.streamCombinedFile(function(err, combinedFileStream) {
    if (err) { res.status(500).end(String(err)); return; }
    var piped = combinedFileStream.pipe(res);
    piped.on('error', function(err) {
      res.status(500).end(String(err)); });
  });
}

FileCombiner.prototype.processHashRequest = function(req, res) {
  var self = this;
  self.streamCombinedFile(function(err, combinedFileStream) {
    if (err) { res.status(500).end(String(err)); return; }
    self.computeHash(combinedFileStream, function(err, hash) {
      if (err) { res.status(500).end(String(err)); return; }
      res.end(hash);
    });
  });
}

FileCombiner.prototype.handleRequest = function() {
  var self = this;
  return function(req, res) {
    var uri = url.parse(req.url, true/*parse query*/);
    if (uri.query && uri.query.hasOwnProperty('hash')) {
      self.processHashRequest(req, res);
    } else {
      self.processJSRequest(req, res);
    }
  }
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// setup
function start(settings, thenDo) {
  var app = settings.app;
  (settings.routes || []).forEach(function(routeSettings) {
    var r = routeSettings.route,
      baseDir = routeSettings.baseDirectory || process.cwd(),
      files = routeSettings.files || [],
      fileCombiner = new FileCombiner(routeSettings);
    app.get(r, fileCombiner.handleRequest());
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
