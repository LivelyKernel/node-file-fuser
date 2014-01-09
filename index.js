var path   = require("path"),
    util   = require("util"),
    fs     = require("fs"),
    async  = require("async"),
    url    = require("url"),
    crypto = require("crypto");

var fWatcher = require("watch-interface");

function FileFuser(options) {
  if (!options) throw new Error('FileFuser requires config object');
  this.baseDirectory = options.baseDirectory;
  this.files = options.files;
  this.combinedFile = options.combinedFile;
}


FileFuser.prototype.getCombinedFilePath = function() {
  return path.join(this.baseDirectory, this.combinedFile);
}

FileFuser.prototype.getCombinedFileStream = function(thenDo) {
  var stream;
  try {
    stream = fs.createReadStream(this.getCombinedFilePath());
  } catch (e) { thenDo(e, stream); }
  thenDo(null, stream);
}

function createHeader(files) {
  return util.format('// This file was generated on %s\n\n'
                   + 'JSLoader.expectToLoadModules([%s]);\n\n',
                     new Date().toGMTString(),
                     files.map(function(fn) { return "'" + fn + "'" }));
}

FileFuser.prototype.writeFilesInto = function(baseDirectory, files, thenDo) {
  var targetFilePath   = this.getCombinedFilePath(),
      targetFileStream = fs.createWriteStream(targetFilePath),
      headerTask       = function(next) { targetFileStream.write(createHeader(files)); next(); },
      writeFileTasks   = [headerTask].concat(files.map(function(file) {
        var fullPath = path.join(baseDirectory, file);
        return function(next) {
          targetFileStream.write(';// ' + file + ':\n');
          var reader = fs.createReadStream(fullPath)
          reader.pipe(targetFileStream, {end: false/*don't close target stream*/});
          reader.on('end', function() {
            targetFileStream.write('\n\n\n');
            next();
          });
        }
      }));

  async.series(writeFileTasks, function(err) {
    if (err) { console.log('error writing %s: %s', targetFilePath, err); }
    targetFileStream.end();
    thenDo(err);
  });
}

FileFuser.prototype.checkIfCombinedFilesAreUpToDate = function(thenDo) {
  thenDo(null, false);
}

FileFuser.prototype.streamCombinedFile = function(thenDo) {
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

FileFuser.prototype.computeHash = function(combinedFileStream, thenDo) {
  var md5sum = crypto.createHash('md5'), hash;
  md5sum.setEncoding('hex');
  md5sum.on('data', function(d) {hash = String(d); });
  md5sum.on('error', function(err) { thenDo(err, null); });
  md5sum.on('end', function() { thenDo(null, hash); });
  combinedFileStream.pipe(md5sum);
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// http interface
FileFuser.prototype.processJSRequest = function(req, res) {
  this.streamCombinedFile(function(err, combinedFileStream) {
    if (err) { res.status(500).end(String(err)); return; }
    var piped = combinedFileStream.pipe(res);
    piped.on('error', function(err) {
      res.status(500).end(String(err)); });
  });
}

FileFuser.prototype.processHashRequest = function(req, res) {
  var self = this;
  self.streamCombinedFile(function(err, combinedFileStream) {
    if (err) { res.status(500).end(String(err)); return; }
    self.computeHash(combinedFileStream, function(err, hash) {
      if (err) { res.status(500).end(String(err)); return; }
      res.end(hash);
    });
  });
}

FileFuser.prototype.handleRequest = function() {
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
// initialize-release
FileFuser.prototype.start = function(thenDo) {
  thenDo && thenDo(null, this);
}

FileFuser.on = function(options, thenDo) {
  // options = {
  //   baseDirectory: STRING,
  //   files [STRING],
  //   combinedFile: STRING -- path to file that holds fused content
  var fileFuser = new FileFuser(options);
  fileFuser.start(thenDo);
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// setup
function start(settings, thenDo) {
  var app = settings.app;
  (settings.routes || []).forEach(function(routeSettings) {
    var r = routeSettings.route,
        baseDir = routeSettings.baseDirectory || process.cwd(),
        files = routeSettings.files || [];
    FileFuser.on(routeSettings, function(err, fuser) {
      if (err) { thenDo(err, null); return; }
      fuser && app.get(r, fuser.handleRequest());
      thenDo && thenDo();
    })
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
