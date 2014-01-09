var path          = require("path"),
    crypto        = require("crypto"),
    http          = require("http"),
    async         = require("async"),
    request       = require("request"),
    fs            = require("fs"),
    fsHelper      = require("lively-fs-helper"),
    handler       = require("../index"),
    port          = 9011,
    baseDirectory = __dirname,
    testDirectory = path.join(baseDirectory, "testDir"),
                    testServer, testApp, fsTimeStamp;

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// debugging
function logProgress(msg) {
  return function(thenDo) { console.log(msg); thenDo && thenDo(); }
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// test server
function createServer(thenDo) {
  var server = testServer = http.createServer();
  server.on('close', function() { console.log('server for tests closed'); });
  server.listen(port, function() {
    console.log('server for tests started');
    thenDo(null, server); });
  var handlers = {};
  server.on('request', function(req, res) {
    var handler = handlers[req.method.toLowerCase()];
    if (!handler)
      throw new Error(
        'no handler for request ' + req.method + ' ' + req.url);
    handler(req, res);
  });
  testApp = {
    get: function(route, handler) {
      // FIXME, use route
      handlers['get'] = handler;
    }
  }
}

function closeServer(server, thenDo) { server.close(thenDo); }

function md5(string) {
    var md5 = crypto.createHash('md5');
    md5.update(String(string));
    return md5.digest('hex');
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// request helpers
function get(path, thenDo) {
  var url = 'http://localhost:' + port + '/' + (path || '');
  request(url, {method: 'GET'}, function(err, res, body) {
    thenDo && thenDo(err, res, body); });
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
      createServer,
      logProgress('server created'),
      function(next) {
        handler.start({
          app: testApp,
          routes: [{
            route: 'combined/some.js',
            baseDirectory: testDirectory,
            combinedFile: 'combined.js',
            files: ['some-folder/file1.js',
                    'some-folder/file4.js',
                    'some-folder/file3.js']
            
          }]
        }, next);
      },
      logProgress('handler setup')
    ], callback);
  },

  tearDown: function (callback) {
    async.series([
      function(next) { handler.close(next); },
      function(next) { testServer.close(next); },
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
    get('combined/some.js', function(err, res, body) {
      test.equal(body, expected);
      test.done();
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
        get('combined/some.js', function(err, res, body) {
          test.equal(body, expected1, 'original content not OK'); next();
        });
      },
      function(next) {
        fs.writeFile(path.join(testDirectory, 'some-folder', 'file4.js'), "changed", next);
      },
      function(next) {
        get('combined/some.js', function(err, res, body) {
          test.equal(body, expected2, "content not updated"); next();
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
        get('combined/some.js?hash', function(err, res, body) {
          test.equal(body, expected1); next();
        }); 
      },
      function(next) {
        fs.writeFile(path.join(testDirectory, 'some-folder', 'file4.js'), "changed", next);
      },
      function(next) {
        get('combined/some.js?hash', function(err, res, body) {
          test.equal(body, expected2); next();
        }); 
      },
    ], test.done);
  }

};

module.exports = tests;
