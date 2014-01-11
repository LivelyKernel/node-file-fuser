var path   = require("path"),
    util   = require("util"),
    fs     = require("fs"),
    async  = require("async"),
    url    = require("url"),
    crypto = require("crypto");

// not yet used...
var fWatcher = require("watch-interface");

function FileFuser(options) {
  if (!options) throw new Error('FileFuser requires config object');
  this.baseDirectory = options.baseDirectory;
  this.files = options.files;
  this.combinedFile = options.combinedFile;
  this.fileWatcher = null;
  this.combinedFileBuildTime = null;
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

function createHeader(timestamp, files) {
  return util.format('// This file was generated on %s\n\n'
                   + 'JSLoader.expectToLoadModules([%s]);\n\n',
                     timestamp.toGMTString(),
                     files.map(function(fn) { return "'" + fn + "'" }));
}

FileFuser.prototype.writeFilesInto = function(baseDirectory, files, thenDo) {
  var time             = this.combinedFileBuildTime = new Date(),
      targetFilePath   = this.getCombinedFilePath(),
      targetFileStream = fs.createWriteStream(targetFilePath),
      headerTask       = function(next) { targetFileStream.write(createHeader(time, files)); next(); },
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

FileFuser.prototype.checkIfCombinedFilesAreUpToDate = function(watcher, thenDo) {
  var targetFilePath = this.getCombinedFilePath(),
      lastBuildTime = this.combinedFileBuildTime;
  async.waterfall([
    function(next) {
      fs.exists(targetFilePath, function(exists) {
        next(null, exists); });
    },
    function(combinedFileExists, next) {
      if (!combinedFileExists) thenDo(null, false);
      else watcher.getChangesSince(lastBuildTime, next);
    },
    function(changes, next) { thenDo(null, changes.length === 0); }
  ], thenDo);
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
// file watcher
FileFuser.prototype.ensureFileWatcher = function(thenDo) {
  var self = this;
  if (self.fileWatcher) { thenDo(null, self.fileWatcher); return; }
  if (self._fileWatcherIsStarting) {
    setTimeout(self.ensureFileWatcher.bind(self, thenDo), 200);
    return;
  }
  self._fileWatcherIsStarting = true;
  fWatcher.onFiles(self.baseDirectory, self.files, {}, function(err, watcher) {
    delete self._fileWatcherIsStarting;
    if (err) { thenDo(err, null); return; }
    self.fileWatcher = watcher;
    thenDo(null, watcher);
  });
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// main interface

FileFuser.prototype.withCombinedFileStreamDo = function(thenDo) {
  var self = this;
  async.waterfall([
    function(next) { self.ensureFileWatcher(next); },
    function(watcher, next) { self.checkIfCombinedFilesAreUpToDate(watcher, next); },
    function(areUpToDate, next) {
      if (areUpToDate) next();
      else self.writeFilesInto(self.baseDirectory, self.files, next);
    }
  ], function(err) {
    if (err) { thenDo(err, null); return; }
    self.getCombinedFileStream(thenDo);
  });
}

FileFuser.prototype.withHashDo = function(doFunc) {
  var self = this;
  self.withCombinedFileStreamDo(function(err, combinedFileStream) {
    if (err) { doFunc(err, null); return; }
    self.computeHash(combinedFileStream, doFunc);
  });
}

FileFuser.prototype.close = function(doFunc) {
  var self = this;
  if (!self.fileWatcher && !self._fileWatcherIsStarting) {
    doFunc && doFunc(null); return; }
  async.waterfall([
    self.ensureFileWatcher.bind(self),
    function(watcher, next) {
      if (!watcher) next(); else watcher.close(next); }
  ], doFunc);
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// exports

module.exports = function(options, thenDo) {
  // options = {
  //   baseDirectory: STRING,
  //   files [STRING],
  //   combinedFile: STRING -- path to file that holds fused content
  var fileFuser = new FileFuser(options);
  fileFuser.ensureFileWatcher(function(err, _) {
    thenDo(err, fileFuser); });
}
