var path          = require("path"),
    crypto        = require("crypto"),
    async         = require("async"),
    fs            = require("fs"),
    fsHelper      = require("lively-fs-helper"),
    createFuser   = require("../index"),
    port          = 9011,
    baseDirectory = __dirname,
    testDirectory = path.join(baseDirectory, "testDir"),
                    fuser, fsTimeStamp;

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// debugging
function logProgress(msg) {
  return function(thenDo) { console.log(msg); thenDo && thenDo(); }
}

function md5(string) {
    var md5 = crypto.createHash('md5');
    md5.update(String(string));
    return md5.digest('hex');
}

function withStreamData(stream, thenDo) {
  var data = '';
  stream.on('data', function(d) { data += String(d); });
  stream.on('end', function() { thenDo(null, data); });
  stream.on('error', function(err) { thenDo(err, data); });
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// tests
var tests = {

  setUp: function (callback) {
    async.series([
      function(next) {
        var files = {
          "testDir": {
            "some-folder": {
              "file1.js": "// file1 content\nfoo + bar + baz",
              "file2.js": "// file2 content\ntest test test\n\n\n\n",
              "file3.js": "// file3 content\ntest test more test",
              "file4.js": "// file4 content\ntest test test more test"
            }
          }
        };
        fsTimeStamp = (new Date()).toGMTString();
        fsHelper.createDirStructure(baseDirectory, files, next);
      },
      logProgress('test files created'),
      function(next) {
        createFuser({
          baseDirectory: testDirectory,
          combinedFile: 'combined.js',
          files: ['some-folder/file1.js',
                  'some-folder/file4.js',
                  'some-folder/file3.js']
          }, function(err, _fuser) { fuser = _fuser; next(err); });
      },
      logProgress('handler setup')
    ], callback);
  },

  tearDown: function (callback) {
    async.series([
      function(next) { if (fuser) fuser.close(next); else next(); },
      fsHelper.cleanupTempFiles
    ], callback);
  },

  testSimpleFileFuse: function(test) {
    var expected = '// This file was generated on ' + fsTimeStamp + '\n\n'
                 + 'JSLoader.expectToLoadModules([\'some-folder/file1.js\',\'some-folder/file4.js\',\'some-folder/file3.js\']);\n\n'
                 + ";// some-folder/file1.js:\n"
                 + "// file1 content\nfoo + bar + baz"
                 + "\n\n\n"
                 + ";// some-folder/file4.js:\n"
                 + "// file4 content\ntest test test more test"
                 + "\n\n\n"
                 + ";// some-folder/file3.js:\n"
                 + "// file3 content\ntest test more test"
                 + "\n\n\n";
    fuser.withCombinedFileStreamDo(function(err, stream) {
      test.ifError(err);
      withStreamData(stream, function(err, data) {
        test.ifError(err);
        test.equal(data, expected);
        test.done();
      });
    });
  },

  testFusedContentIsUpdatedWhenFileChanges: function(test) {
    var expected1 = '// This file was generated on ' + fsTimeStamp + '\n\n'
                  + 'JSLoader.expectToLoadModules([\'some-folder/file1.js\',\'some-folder/file4.js\',\'some-folder/file3.js\']);\n\n'
                  + ";// some-folder/file1.js:\n"
                  + "// file1 content\nfoo + bar + baz"
                  + "\n\n\n"
                  + ";// some-folder/file4.js:\n"
                  + "// file4 content\ntest test test more test"
                  + "\n\n\n"
                  + ";// some-folder/file3.js:\n"
                  + "// file3 content\ntest test more test"
                  + "\n\n\n",
        expected2 = expected1.replace("// file4 content\ntest test test more test", "changed");
    async.series([
      function(next) {
        fuser.withCombinedFileStreamDo(function(err, stream) {
          test.ifError(err);
          withStreamData(stream, function(err, data) {
            test.ifError(err);
            test.equal(data, expected1, 'original content not OK');
            next();
          });
        });
      },
      function(next) {
        fs.writeFile(path.join(testDirectory, 'some-folder', 'file4.js'), "changed", next);
      },
      function(next) {
        fuser.withCombinedFileStreamDo(function(err, stream) {
          test.ifError(err);
          withStreamData(stream, function(err, data) {
            test.ifError(err);
            test.equal(data, expected2, "content not updated");
            next();
          });
        });
      }
    ], test.done);
  },

  testHashIsUpdatedWhenFileChanges: function(test) {
    var content1 = '// This file was generated on ' + fsTimeStamp + '\n\n'
                  + 'JSLoader.expectToLoadModules([\'some-folder/file1.js\',\'some-folder/file4.js\',\'some-folder/file3.js\']);\n\n'
                  + ";// some-folder/file1.js:\n"
                  + "// file1 content\nfoo + bar + baz"
                  + "\n\n\n"
                  + ";// some-folder/file4.js:\n"
                  + "// file4 content\ntest test test more test"
                  + "\n\n\n"
                  + ";// some-folder/file3.js:\n"
                  + "// file3 content\ntest test more test"
                  + "\n\n\n",
        content2 = content1.replace("// file4 content\ntest test test more test", "changed"),
        expected1 = md5(content1),
        expected2 = md5(content2);
    async.series([
      function(next) {
        fuser.withHashDo(function(err, hash) {
          test.ifError(err);
          test.equal(hash, expected1); next();
        });
      },
      function(next) {
        fs.writeFile(path.join(testDirectory, 'some-folder', 'file4.js'), "changed", next);
      },
      function(next) {
        fuser.withHashDo(function(err, hash) {
          test.ifError(err);
          test.equal(hash, expected2); next();
        });
      },
    ], test.done);
  }

};

module.exports = tests;
