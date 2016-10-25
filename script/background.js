'use strict';

// An object used for caching data about the browser's cookies.
class CookieCache {
    constructor() {
        this.cookies_ = {};
    }
    // Clears all cached cookies.
    reset() {
        this.cookies_ = {};
    }
    // Adds cookie to the cache.
    add(cookie) {
        var domain = cookie.domain;
        if (!this.cookies_[domain]) {
            this.cookies_[domain] = [];
        }
        this.cookies_[domain].push(cookie);
    }
    // Removes cookie from the cache.
    remove(cookie) {
        var domain = cookie.domain;
        if (this.cookies_[domain]) {
            var i = 0;
            while (i < this.cookies_[domain].length) {
                if (CookieCache.cookieMatch(this.cookies_[domain][i], cookie)) {
                    this.cookies_[domain].splice(i, 1);
                } else {
                    i++;
                }
            }
            if (this.cookies_[domain].length == 0) {
                delete this.cookies_[domain];
            }
        }
    }
    // Gets all cookies stored in cache.
    getAll() {
      return this.cookies_;
    }
    // Gets all domains for which the cookie exists.
    getDomains(filter) {
        var result = [];
        CookieCache.sortedKeys(this.cookies_).forEach(function(domain) {
            if (!filter || domain.indexOf(filter) !== -1) {
                result.push(domain);
            }
        });
        return result;
    }
    // Gets cookies for given domain.
    getCookies(domain) {
        return this.cookies_[domain];
    }

    //Compares cookies for "key" (name, domain, etc.) equality, but not "value" equality.
    static cookieMatch(c1, c2) {
        return (c1.name == c2.name) && (c1.domain == c2.domain) &&
            (c1.hostOnly == c2.hostOnly) && (c1.path == c2.path) &&
            (c1.secure == c2.secure) && (c1.httpOnly == c2.httpOnly) &&
            (c1.session == c2.session) && (c1.storeId == c2.storeId);
    }
    // Returns an array of sorted keys from an associative array.
    static sortedKeys(array) {
        var keys = Object.keys(array);
        keys.sort();
        return keys;
    }
}

// Main extension object.
class CookieExchange {
  constructor() {
    // Cache object for fast cookie access.
    this.cache = undefined;
    // Connected clients. When cookie change they will receive a notification about that.
    this.clients = [];
  }
  // Set up the listeners to listen for external clients.
  setUp() {
    chrome.runtime.onConnectExternal.addListener(this.externalConnectListener);
    this.notifyExtensionLoaded();
  }
  // Connection from other clients will be rejected. This is ARC only extension.
  get allowedClients() {
    return [
      'ffgciingieijajcbpkockcbknajffbel', // canary
      'okeafnfmgoafdfbcjkanpgmjanccpell', // dev
      'epgngalmiadbjnoompchcohonhidjanm', // beta
      'hgmloofddffdnphfgcellkdfbfbjeloo' // stable
    ];
  }

  get externalConnectListener() {
    if (!this._externalConnectListener) {
      this._externalConnectListener = this._clientConnected.bind(this);
    }
    return this._externalConnectListener;
  }

  get cookieChangeListener() {
    if (!this._cookieChangeListener) {
      this._cookieChangeListener = this._cookieChanged.bind(this);
    }
    return this._cookieChangeListener;
  }

  listen() {
    chrome.cookies.onChanged.addListener(this.cookieChangeListener);
  }

  unlinsten() {
    chrome.cookies.onChanged.removeListener(this.cookieChangeListener);
  }

  load() {
    chrome.cookies.getAll({}, (cookies) => {
      for (let i in cookies) {
        this.cache.add(cookies[i]);
      }
    });
  }

  // Botify running apps that the extension hass been loaded.
  notifyExtensionLoaded() {
    var ids = [
      'ffgciingieijajcbpkockcbknajffbel',
      'okeafnfmgoafdfbcjkanpgmjanccpell',
      'epgngalmiadbjnoompchcohonhidjanm',
      'hgmloofddffdnphfgcellkdfbfbjeloo'
    ];
    ids.forEach((i) => chrome.runtime.sendMessage(i, {loaded: true}));
  }

  _clientConnected(port) {
    // console.log('Client connected', port);

    if (!port.sender || !port.sender.id) {
      console.warn('Unauthorized.');
      return;
    }
    if (this.allowedClients.indexOf(port.sender.id) === -1) {
      console.warn('Unauthorized.');
      return;
    }

    var fn = (msg) => {
      this._processMessage(port, msg);
    };
    var rmPortFn = () => {
      port.onMessage.removeListener(fn);
      port.onDisconnect.removeListener(rmPortFn);
      for (let i = this.clients.length - 1; i <= 0; i--) {
        if (this.clients[i] === port) {
          this.clients.splice(i, 1);
          break;
        }
      }
      if (this.clients.length === 0) {
        this.unlinsten();
        this.cache = undefined;
      }
    };
    port.onMessage.addListener(fn);
    port.onDisconnect.addListener(rmPortFn);
    this.clients.push(port);
    if (!this.cache) {
      this.cache = new CookieCache();
      this.listen();
      this.load();
    }
  }

  _cookieChanged(info) {
    if (!this.cache) {
      return;
    }
    this.cache.remove(info.cookie);
    if (!info.removed) {
      this.cache.add(info.cookie);
    }
    this._informCookieChanged();
  }

  _processMessage(port, msg) {
    switch (msg.payload) {
      case 'get-cookies':
        port.postMessage({
          'payload': 'get-cookies',
          'cookies': this.cache.getAll()
        });
        break;
      case 'proxy-xhr':
        this._proxyXhr(port, msg.request);
        break;
      default:
        port.postMessage({
          'payload': 'unknown'
        });
        break;
    }
    console.log('message from client', msg);
  }
  // Inform all listeners that the cookie has changed.
  _informCookieChanged() {
    this.clients.forEach((port) => {
      port.postMessage({payload: 'cookie-changed'});
    });
  }

  _proxyXhr(port, request) {
    var log = [];
    var errorFn = (e) => {
      // console.dir(e);
      let rtn = {
        'error': true,
        'log': log,
        'message': e.message || 'Network error.',
        payload: 'proxy-xhr'
      };
      port.postMessage(rtn);
    };
    var startTime = 0;
    var startDate = Date.now();
    var xhr = new XMLHttpRequest();
    try {
      xhr.open(request.method, request.url, true);
    } catch(e) {
      errorFn(e);
      return;
    }

    var loadFn = (e) => {
      let loadTime = window.performance.now() - startTime;
      let t = e.target;
      let headers = t.getAllResponseHeaders();
      let authData;
      if (t.status === 401) {
        let list = headers.split('\n');
        let _auth = list.find((i) => i.toLowerCase().indexOf('www-authenticate') !== -1);
        if (_auth) {
          _auth = _auth.toLowerCase();
          if (_auth.indexOf('basic') !== -1) {
            authData = {
              method: 'basic'
            };
          }
          //  else if (_auth.indexOf('ntlm') !== -1) {
          //   authData = {
          //     method: 'ntlm'
          //   };
          // }
        }
      }


      let rtn = {
        response: {
          response: t.response,
          responseText: t.responseText,
          responseType: t.responseType,
          responseURL: t.responseURL,
          status: t.status,
          statusText: t.statusText,
          readyState: t.readyState,
          headers: t.getAllResponseHeaders(),
          stats: {
            receive: loadTime,
            startTime: startDate
          }
        },
        log: log,
        payload: 'proxy-xhr'
      };

      if (authData) {
        rtn.auth = authData;
      }

      console.log('Response ready.', rtn);
      port.postMessage(rtn);
    };

    // set headers
    var h = request.headers;
    if (h instanceof Array) {
      log.push('Setting up headers. (' + h.length + ' headers to add)');
      h.forEach((i) => {
        try {
          xhr.setRequestHeader(i.name, i.value);
        } catch (e) {
          log.push(`Can't set header ${i.name} in the XHR call. Try socket connection.`);
        }
      })
    }
    //var the_file = new Blob([window.atob(png)],  {type: 'image/png', encoding: 'utf-8'});
    var data = undefined;
    if (['get', 'head'].indexOf(request.method.toLowerCase()) === -1) {
      if (request.files && request.files.length) {
        let fd = new FormData();
        let list;
        try {
          list = PayloadParser.parseString(request.payload);
        } catch (e) {
          log.push('Error parsing payload to form data values. ' + e.message);
        }
        if (list && list.length) {
          list.forEach((i) => fd.append(i.name, i.value));
        }
        request.files.forEach((f) => {
          let files = f.files;
          for (let i = 0, len = files.length; i < len; i++) {
            let file = new Blob([atob(files[i].file)],  {type: files[i].mime, encoding: 'utf-8'});
            fd.append(f.name, file);
          }
        });
        data = fd;
        log.push('FormData ready to send.');
      } else if (request.payload) {
        data = request.payload;
        log.push('Payload ready to send');
      }
    }
    xhr.addEventListener('load', loadFn);
    xhr.addEventListener('error', errorFn);
    xhr.addEventListener('timeout', errorFn);
    try {
      startTime = window.performance.now();
      xhr.send(data);
    } catch(e) {
      errorFn(e);
      return;
    }
  }
}

var exchange = new CookieExchange();
exchange.setUp();
