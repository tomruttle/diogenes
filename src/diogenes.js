(function () {
  'use strict';

  /*

  Imports

  */

  if (typeof exports === 'object') {
    require('setimmediate');
  }

  var or = typeof exports === 'object' ? require('occamsrazor') : window.occamsrazor;

  /*

  polyfills

  */
  if (typeof Object.assign != 'function') {
    (function () {
      Object.assign = function (target) {
        'use strict';
        if (target === undefined || target === null) {
          throw new TypeError('Cannot convert undefined or null to object');
        }

        var output = Object(target);
        for (var index = 1; index < arguments.length; index++) {
          var source = arguments[index];
          if (source !== undefined && source !== null) {
            for (var nextKey in source) {
              if (source.hasOwnProperty(nextKey)) {
                output[nextKey] = source[nextKey];
              }
            }
          }
        }
        return output;
      };
    })();
  }

  /*

  Service object

  */

  function Service(name, registry) {
    this.name = name;
    this._desc = '';
    this._registry = registry; // backreference
    this._funcs = or();
    this._deps = or().notFound(function () {
      return [];
    });
  }

  Service.prototype.registry = function service_registry() {
    return this._registry;
  };

  Service.prototype.description = function service_description(desc) {
    if (typeof desc === 'undefined') {
      return this._desc;
    }
    this._desc = desc;
    return this;
  };

  Service.prototype.metadata = function service_metadata(meta) {
    if (typeof meta === 'undefined') {
      return this.meta;
    }
    this.meta = meta;
    return this;
  };

  Service.prototype.infoObj = function service_infoObj(config) {
    var out = {};
    out.name = this.name;
    out.description = this.description();
    out.dependencies = this.get(config, true).deps;

    try {
      out.executionOrder = this._registry
      .getExecutionOrder(this.name, config, true)
      .slice(0, -1);
    }
    catch (e) {
      out.inactive = true;
      out.dependencies = [];
    }

    out.cached = !!this.cache;
    out.manageError = !!this.onError;

    out.metadata = this.metadata();
    return out;
  };

  Service.prototype.info = function service_info(config) {
    var infoObj = this.infoObj(config);
    var rows = [infoObj.name];
    rows.push(infoObj.name.split('').map(function () {return '=';}).join(''));
    rows.push(infoObj.description);

    if (infoObj.inactive) {
      rows.push('Not available with this configuration.');
    }

    if (infoObj.executionOrder.length > 0) {
      rows.push('');
      rows.push('Execution order:');
      infoObj.executionOrder.forEach(function (d) {
        rows.push('* ' + d);
      });
    }

    if (infoObj.dependencies.length > 0) {
      rows.push('');
      rows.push('Dependencies:');
      infoObj.dependencies.forEach(function (d) {
        rows.push('* ' + d);
      });
    }

    if (infoObj.metadata) {
      rows.push('');
      rows.push('Metadata:');
      rows.push('```js');
      rows.push(JSON.stringify(infoObj.metadata, null, '  '));
      rows.push('```');
    }

    rows.push('');
    if (infoObj.cached) {
      rows.push('* Cached');
    }
    if (infoObj.manageError) {
      rows.push('* it doesn\'t throw exceptions');
    }

    return rows.join('\n');
  };

  Service.prototype.dependsOn = function service_dependsOn() {
    var deps = arguments[arguments.length - 1];
    var depsFunc = typeof deps === 'function' ? deps : function () {return deps;};
    if (arguments.length > 1) {
      this._deps.add(or.validator().match(arguments[0]), depsFunc);
    }
    else {
      this._deps.add(or.validator(), depsFunc);
    }
    return this;
  };

  Service.prototype._returns = function service__returns() {
    var method = arguments[arguments.length - 1];
    var func = arguments[arguments.length - 2];
    var arity = func.length;
    var adapter = function () {
      return {func: func, arity: arity};
    };

    if (arguments.length > 3) {
      this._funcs[method](or.validator().match(arguments[0]),
                      or.validator().match(arguments[1]), adapter);
    }
    else if (arguments.length > 2) {
      this._funcs[method](or.validator().match(arguments[0]), adapter);
    }
    else {
      this._funcs[method](or.validator(), adapter);
    }
    return this;
  };


  Service.prototype.returns = function service_returns() {
    var args = Array.prototype.slice.call(arguments, 0);
    args.push('add');
    return this._returns.apply(this, args);
  };

  Service.prototype.returnsValue = function service_returnsValue() {
    var args = Array.prototype.slice.call(arguments, 0);
    var value = args[args.length - 1];
    args[args.length - 1] = function (conf, deps) {
      return value;
    };
    args.push('add');
    return this._returns.apply(this, args);
  };

  Service.prototype.returnsOnce = function service_returnsOnce() {
    var args = Array.prototype.slice.call(arguments, 0);
    args.push('one');
    return this._returns.apply(this, args);
  };

  Service.prototype.returnsValueOnce = function service_returnsOnceValue() {
    var args = Array.prototype.slice.call(arguments, 0);
    var value = args[args.length - 1];
    args[args.length - 1] = function (conf, deps) {
      return value;
    };
    args.push('one');
    return this._returns.apply(this, args);
  };


  Service.prototype.remove = function service_remove() {
    this._registry.remove(this.name);
  };

  Service.prototype.get = function service_get(config, noCache) {
    var key, hit;
    if (this.cache && !this.pauseCache && !noCache) { // cache check here !!!
      this.cachePurge(); // purge stale cache entries
      key = this.key(config);
      if (key in this.cache) {
        hit = this.cache[key]; // cache hit!
        return {
          name: this.name,
          service: {
            arity: 3,
            func: function (config, deps, next) {
              next(undefined, hit);
            }
          },
          deps: [], // no dependencies needed for cached values
          cached: true
        };
      }
    }
    try {
      return {
        name: this.name,
        service: this._funcs(config),
        deps: this._deps(config)
      };
    }
    catch (e) {
      // this should throw only if this service
      // is part of the execution graph
      return {
        error: e
      };
    }
  };

  Service.prototype.run = function service_run(globalConfig, done) {
    this._registry.run(this.name, globalConfig, done);
    return this;
  };

  Service.prototype.cacheOn = function service_cacheOn(opts) {
    opts = opts || {};
    var key = opts.key;

    if (typeof key === 'function') {
      this.key = key;
    }
    else if (typeof key === 'string') {
      this.key = function (config) {
        if (typeof config[key] === 'object') {
          return JSON.stringify(config[key]);
        }
        else {
          return config[key];
        }
      };
    }
    else if (Array.isArray(key)) {
      this.key = function (config) {
        var value = config;
        for (var i = 0; i < key.length; i++) {
          value = value[key[i]];
        }
        if (typeof value === 'object') {
          return JSON.stringify(value);
        }
        else {
          return value;
        }
      };
    }
    else {
      this.key = function (config) {
        return '_default';
      };
    }

    this.cache = {}; // key, value
    this.cacheKeys = []; // sorted by time {ts: xxx, key: xxx} new ones first

    this.maxAge = opts.maxAge || Infinity;
    this.maxSize = opts.maxSize || Infinity;
  };

  Service.prototype.cachePush = function service_cachePush(config, output) {
    if (!this.cache) return;
    var k = this.key(config);
    if (k in this.cache) return;
    this.cache[k] = output;
    this.cacheKeys.unshift({
      key: k,
      ts: Date.now()
    });
    this.cachePurge();
  };

  Service.prototype.cachePurge = function service_cachePurge() {
    if (!this.cache) return;
    // remove old entries
    var maxAge = this.maxAge;
    var maxSize = this.maxSize;
    var cache = this.cache;

    var now = Date.now();
    this.cacheKeys = this.cacheKeys.filter(function (item) {
      if (item.ts + maxAge < now ) {
        delete cache[item.key];
        return false;
      }
      return true;
    });

    // trim cache
    var keysToRemove = this.cacheKeys.slice(maxSize, Infinity);
    keysToRemove.forEach(function (item) {
      var k = item.key;
      delete cache[k];
    });
    this.cacheKeys = this.cacheKeys.slice(0, maxSize);
  };

  Service.prototype.cacheOff = function service_cacheOff() {
    this.cache = undefined;
    this.cacheKeys = undefined;
  };

  Service.prototype.cachePause = function service_cachePause() {
    this.pauseCache = true;
  };

  Service.prototype.cacheResume = function service_cacheResume() {
    this.pauseCache = undefined;
  };

  Service.prototype.cacheReset = function service_cacheReset() {
    this.cache = {}; // key, value
    this.cacheKeys = []; // sorted by time {ts: xxx, key: xxx}
  };

  // on error
  Service.prototype.onErrorReturn = function service_onErrorReturn(value) {
    this.onError = function (config) {
      return value;
    };
  };

  Service.prototype.onErrorExecute = function service_onErrorExecute(func) {
    this.onError = func;
  };

  Service.prototype.onErrorThrow = function service_onErrorThrow() {
    this.onError = undefined;
  };

  // events
  Service.prototype.on = function service_on() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift(this.name);
    this._registry.on.apply(this._registry, args);
    return this;
  };

  Service.prototype.one = function service_one() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift(this.name);
    this._registry.one.apply(this._registry, args);
    return this;
  };

  Service.prototype.off = function service_off() {
    var args = Array.prototype.slice.call(arguments);
    this._registry.off.apply(this._registry, args);
    return this;
  };

  /*

  Registry utilities

  */
  // depth first search
  function dfs(adjlists, startingNode) {
    var already_visited = {};
    var already_backtracked = {};
    var adjlist, node;
    var stack = [startingNode];
    var out = [];

    while (stack.length) {
      node = stack[stack.length - 1];
      already_visited[node] = true;

      if (!adjlists(node)) {
        throw new Error('Diogenes: missing dependency: ' + node);
      }

      if (adjlists(node).error) throw adjlists(node).error;
      adjlist = adjlists(node).deps.filter(function (adj) {
        if (adj in already_visited && !(adj in already_backtracked)) {
          throw new Error('Diogenes: circular dependency: ' + adj);
        }
        return !(adj in already_visited);
      });

      if (adjlist.length) {
        stack.push(adjlist[0]);
      }
      else {
        already_backtracked[node] = true; // detecting circular deps
        out.push(node);
        stack.pop();
      }
    }
    return out;
  }

  function isPromise(obj) {
    return 'then' in obj;
  }

  function getDependencies(currentDeps, requiredDeps) {
    var deps = {};
    for (var i = 0; i < requiredDeps.length; i++) {
      if (!(requiredDeps[i] in currentDeps)) {
        return; // I can't execute this because a deps is missing
      }
      deps[requiredDeps[i]] = currentDeps[requiredDeps[i]];
    }
    return deps;
  }

  function depsHasError(currentDeps, requiredDeps) {
    for (var i = 0; i < requiredDeps.length; i++) {
      if (currentDeps[requiredDeps[i]] instanceof Error) {
        return currentDeps[requiredDeps[i]]; // one of the deps is an error
      }
    }
    return false;
  }

  function getFunc2(registry, service, node, error, deps, globalConfig, callback) {
    if (error) { // propagated error
      return function () {
        return callback(service.name, typeof service.onError !== 'undefined' ? service.onError(globalConfig) : error, node.cached);
      };
    }

    var wrapped_func = function (err, dep) {
      var d;
      if (err) {
        d = typeof service.onError !== 'undefined' ? service.onError(globalConfig) : err;
      }
      else {
        d = dep;
      }
      return callback(service.name, d, node.cached);
    };

    return function () {
      var result;
      try {
        if (node.service.length < 3) { // no callback
          result = node.service.call(registry, globalConfig, deps);
          if (typeof result == 'object' && isPromise(result)) {
            result.then(function (res) { // onfulfilled
              wrapped_func(undefined, res);
            },
            function (error) { // onrejected
              wrapped_func(error);
            });
          }
          else {
            wrapped_func(undefined, result);
          }
        }
        else { // callback
          node.service.call(registry, globalConfig, deps, wrapped_func);
        }
      }
      catch (err) {
        return callback(node.name, typeof service.onError !== 'undefined' ? service.onError(globalConfig) : err, node.cached);
      }
    };
  }


  function getFunc(registry, node, onError, dependencies, globalConfig, callback) {
    var deps = {};
    var error = false;
    for (var i = 0; i < node.deps.length; i++) {
      if (!(node.deps[i] in dependencies)) {
        return; // I can't execute this because a deps is missing
      }
      deps[node.deps[i]] = dependencies[node.deps[i]];
      if (dependencies[node.deps[i]] instanceof Error) {
        error = dependencies[node.deps[i]]; // one of the deps is an error
      }
    }

    if (error) {
      return function () {
        return callback(node.name, typeof onError !== 'undefined' ? onError(globalConfig) : error, node.cached);
      };
    }

    return function () {
      var result;
      var wrapped_func = function (err, dep) {
        if (err) {
          return callback(node.name, typeof onError !== 'undefined' ? onError(globalConfig) : err, node.cached);
        }
        else {
          return callback(node.name, dep, node.cached);
        }
      };

      try {
        if (node.service.arity < 3) { // no callback

//        if (node.service.length < 3) { // no callback
//        if (false) { // no callback
          result = node.service.func.call(registry, globalConfig, deps);
          if (typeof result == 'object' && isPromise(result)) {
            result.then(function (res) { // onfulfilled
              wrapped_func(undefined, res);
            },
            function (error) { // onrejected
              wrapped_func(error);
            });
          }
          else {
            wrapped_func(undefined, result);
          }
        }
        else { // callback
          node.service.func.call(registry, globalConfig, deps, wrapped_func);
        }
      }
      catch (err) {
        return callback(node.name, typeof onError !== 'undefined' ? onError(globalConfig) : err, node.cached);
      }
    };
  }

  function debugStart(name, debugInfo) {
    if (!(name in debugInfo)) {
      debugInfo[name] = {};
    }
    debugInfo[name].start = Date.now();
  }

  function debugEnd(name, debugInfo) {
    if (!(name in debugInfo)) {
      debugInfo[name] = {};
    }

    debugInfo[name].end = Date.now();
    debugInfo[name].delta = debugInfo[name].end - debugInfo[name].start;
  }

  // initialize global registries
  var _registries = typeof window == 'undefined' ? global : window;

  if (!_registries._diogenes_registries) {
    _registries._diogenes_registries = {};
    _registries._diogenes_event_handlers = {};
  }

  /*

  Registry object

  */

  function Diogenes(regName) {
    // if regName exists I'll use a global registry
    if (regName) {
      if (!(regName in _registries._diogenes_registries)) {
        _registries._diogenes_registries[regName] = {};
      }
      if (!(regName in _registries._diogenes_event_handlers)) {
        _registries._diogenes_event_handlers[regName] = {};
      }
      this.services = _registries._diogenes_registries[regName];
      this.events = _registries._diogenes_event_handlers[regName];
    }
    else {
      this.services = {};
      this.events = or();
    }
  }

  Diogenes.getRegistry = function registry_getRegistry(regName) {
    return new Diogenes(regName);
  };

  Diogenes.prototype.init = function registry_init(funcs) {
    for (var i = 0; i < funcs.length; i++) {
      funcs[i].apply(this);
    }
  };

  Diogenes.prototype.forEach = function registry_forEach(callback) {
    for (var name in this.services) {
      callback.call(this.services[name], this.services[name], name);
    }
  };

  Diogenes.prototype.infoObj = function registry_infoObj(config) {
    var out = {};
    this.forEach(function (service, name) {
      out[name] = this.infoObj(config);
    });
    return out;
  };

  Diogenes.prototype.info = function registry_info(config) {
    var out = [];
    this.forEach(function (service) {
      out.push(this.info(config));
    });
    return out.join('\n\n');
  };

  Diogenes.prototype.merge = function registry_merge() {
    var registry = new Diogenes();

    var events = Array.prototype.map.call(arguments, function (reg) {
      return reg.events;
    });

    var services = Array.prototype.map.call(arguments, function (reg) {
      return reg.services;
    });

    services.unshift(this.services);
    services.unshift({});

    registry.events = this.events.merge.apply(null, events);
    registry.services = Object.assign.apply(null, services);
    return registry;
  };

  Diogenes.prototype.service = function registry_service(name) {
    if (typeof name !== 'string') {
      throw new Error('Diogenes: the name of the service should be a string');
    }

    if (!(name in this.services)) {
      this.services[name] = new Service(name, this);
    }

    return this.services[name];
  };

  Diogenes.prototype._forEachService = function registry__forEachService(method) {
    this.forEach(function () {
      this[method]();
    });
  };

  Diogenes.prototype.cacheReset = function registry_cacheReset() {
    this._forEachService('cacheReset');
  };

  Diogenes.prototype.cacheOff = function registry_cacheOff() {
    this._forEachService('cacheOff');
  };

  Diogenes.prototype.cachePause = function registry_cachePause() {
    this._forEachService('cachePause');
  };

  Diogenes.prototype.cacheResume = function registry_cacheResume() {
    this._forEachService('cacheResume');
  };

  Diogenes.prototype._filterByConfig = function registry__filterByConfig(globalConfig, noCache) {
    var cache = {};
    var services = this.services;
    return function (name) {
      if (!(name in cache)) {
        if (!(name in services)) return;
        cache[name] = services[name].get(globalConfig, noCache);
      }
      return cache[name];
    };
  };

  Diogenes.prototype.remove = function registry_remove(name) {
    delete this.services[name];
    return this;
  };

  Diogenes.prototype.getExecutionOrder = function registry_getExecutionOrder(name, globalConfig, noCache) {
    var adjlists = this._filterByConfig(globalConfig, noCache);
    var sorted_services = dfs(adjlists, name);
    return sorted_services;
  };

  Diogenes.prototype._run = function registry__run(name, globalConfig, done) {
    var adjlists, sorted_services;
    var deps = {}; // all dependencies already resolved
    var debugInfo = {}; // profiling
    var that = this;
    var services = this.services;

    try {
      adjlists = this._filterByConfig(globalConfig);
      sorted_services = dfs(adjlists, name);
    }
    catch (e) {
      return done.call(that, e);
    }

    debugStart('__all__', debugInfo);
    (function resolve(name, dep, cached) {
      var func, i = 0;

      if (name) {
        deps[name] = dep;
        debugEnd(name, debugInfo);
        if (!(dep instanceof Error)) {
          services[name].cachePush(globalConfig, dep);

          if (!cached) {
            setImmediate(function () {
              that.trigger(name, dep, globalConfig);
            });
          }
        }
      }

      if (sorted_services.length === 0) {
        debugEnd('__all__', debugInfo);
        if (dep instanceof Error) {
          return done.call(that, dep, deps, debugInfo);
        }
        else {
          return done.call(that, undefined, dep, deps, debugInfo);
        }
      }

      while (i < sorted_services.length) {
        func = getFunc(that, adjlists(sorted_services[i]), services[sorted_services[i]].onError, deps, globalConfig, resolve);
        if (func) {
          debugStart(sorted_services[i], debugInfo);
          sorted_services.splice(i, 1);
          setImmediate(func);
        }
        else {
          i++;
        }
      }
    }());

    return this;
  };

  Diogenes.prototype.run = function registry_run(name, globalConfig, done) {
    var newreg = new Diogenes();

    if (typeof globalConfig === 'function') {
      done = globalConfig;
      globalConfig = {};
    }

    if (typeof globalConfig === 'undefined') {
      done = function () {};
      globalConfig = {};
    }

    if (typeof name === 'string') {
      this._run(name, globalConfig, done);
      return this;
    }

    newreg.service('__main__').dependsOn(name).returns(function (config, deps, next) {
      next(undefined, deps);
    });

    var tempreg = newreg.merge(this);
    tempreg.run('__main__', globalConfig, done);
    return this;
  };

  // events
  Diogenes.prototype.on = function registry_on() {
    var args = Array.prototype.slice.call(arguments);
    this.events.on.apply(this, args);
    return this;
  };

  Diogenes.prototype.one = function registry_one() {
    var args = Array.prototype.slice.call(arguments);
    this.events.one.apply(this, args);
    return this;
  };

  Diogenes.prototype.off = function registry_off() {
    var args = Array.prototype.slice.call(arguments);
    this.events.off.apply(this, args);
    return this;
  };

  Diogenes.prototype.trigger = function registry_trigger() {
    var args = Array.prototype.slice.call(arguments);
    this.events.trigger.apply(this, args);
    return this;
  };

  /*

  Exports

  */

  Diogenes.validator = or.validator;

  if (typeof exports === 'object') {
    module.exports = Diogenes;
  }
  else if (typeof window === 'object') {
    // Expose Diogenes to the browser global object
    window.Diogenes = Diogenes;
  }

}());
