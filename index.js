const redis = require('redis');
const logger = require('./lib/logger');
const { fromString, mergeObjects, isEmpty } = require('./lib/utils');

let config = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || '6379',
  dataPrefix: 'lb_',
  maxReconnectAttemptTimout: 3000,
  maxReconnectTimeout: 60 * 60 * 1000,
};

let redisReady = false;

let params = {
  retry_strategy: options => {
    if (options.total_retry_time > config.maxReconnectTimeout) {
      // End reconnecting after a specific timeout and flush all commands with a individual error
      return new Error('Redis reconnection retry time exhausted');
    }
    if (options.times_connected > 100) {
      // End reconnecting with built in error
      return undefined;
    }
    // reconnect after
    return Math.max(options.attempt * 100, config.maxReconnectAttemptTimout);
  },
  no_ready_check: true,
};

const createRedisClient = opts => {
  return process.env.REDIS_URL
    ? redis.createClient(process.env.REDIS_URL, opts)
    : redis.createClient(config.port, config.host, opts);
};

let redisClient;
let redisPubSubClient;

const initialize = options =>
  new Promise((resolve, reject) => {
    config = mergeObjects(config, options);
    redisClient = createRedisClient(params);
    redisPubSubClient = createRedisClient(params);
    redisClient.on('ready', () => {
      logger.info('Redis client ready for worker - ', process.pid);
      redisReady = true;
      resolve();
    });
    redisPubSubClient.on('ready', () =>
      logger.info('Redis pub/sub client ready for worker - ', process.pid)
    );
  });

/**
 * Get instance of PubSub redis client
 */
const getPubSubRedisClient = () => redisPubSubClient;

/**
 * Retrieve data from redis data storage using methods for different data types
 * @param {String} method   name of redis client method
 * @param {String} key      key under which data was stored
 * @returns {Promise}
 * @private
 */
const _get = (method, key) =>
  new Promise((resolve, reject) => {
    if (!redisReady) {
      return Promise.reject('Redis is not ready');
    }
    redisClient[method](config.dataPrefix + key, (err, result) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(result);
    });
  });

/**
 * Store data to redis data storage using methods for different data types
 * @param {String} method       name of redis client method
 * @param {String} key           key under which data will be stored
 * @param {*} value              data to store
 * @param {Number} [lifetime]  lifetime of key in seconds
 * @returns {Promise}
 * @private
 */
const _set = (method, key, value, lifetime) =>
  new Promise((resolve, reject) => {
    if (!redisReady) {
      return Promise.reject('Redis is not ready');
    }
    let onResult = (err, result) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(result);
    };
    if (lifetime) {
      redisClient[method](
        config.dataPrefix + key,
        value,
        'NX',
        'EX',
        lifetime,
        onResult
      );
      return;
    }
    redisClient[method](config.dataPrefix + key, value, onResult);
  });

/**
 * Store data for primitive type
 * @param {String} key      key under which data will be stored
 * @param {*} value         data of primitive type
 * @returns {Promise}
 */
const setValue = (key, value, lifetime) => _set('set', key, value, lifetime);

/**
 * Retrieve stored data of primitive type
 * @param {String} key      key under which data was stored
 * @returns {Promise}
 */
const getValue = key => _get('get', key).then(fromString);
/**
 * Store one level object (without nested objects)
 * @param {String} key      key under which data will be stored
 * @param {Object} value    data as simple object
 * @param {Number} [lifetime]     lifetime of key in seconds
 * @returns {Promise}
 */
const setObject = (key, value, lifetime) => {
  let result = {};
  Object.keys(value).forEach(property => {
    if (value.hasOwnProperty(property)) {
      result[property] = String(value[property]);
    }
  });
  return _set('hmset', key, result, lifetime);
};

/**
 * Retrieve stored object
 * @param {String} key      key under which data was stored
 * @returns {Promise}
 */
const getObject = key =>
  _get('hgetall', key).then(object => {
    if (isEmpty(object)) {
      return null;
    }
    let result = {};
    Object.keys(object).forEach(property => {
      if (object.hasOwnProperty(property)) {
        result[property] = fromString(object[property]);
      }
    });
    return result;
  });

/**
 * Returns true if passed key exist in Redis
 * @param key Key for check
 */
const isKeyExist = key =>
  new Promise((resolve, reject) => {
    redisClient.exists(config.dataPrefix + key, (err, reply) => {
      if (err) {
        reject(err);
      }
      resolve({ reply });
    });
  });

/**
 * Store array of primitive type values
 * @param {String} key      key under which data will be stored
 * @param {*[]|*} value       data as array of values or single value of primitive type
 * @returns {Promise}
 */
const setList = (key, value) =>
  new Promise((resolve, reject) => {
    if (value.length === 0) {
      reject(new Error("Can't store empty array"));
      return;
    }
    _set('sadd', key, value)
      .then(resolve)
      .catch(reject);
  });

/**
 * Retrieve stored array
 * @param {String} key      key under which data was stored
 * @returns {Promise}
 */
const getList = key =>
  _get('smembers', key).then(list => {
    if (isEmpty(list)) {
      return [];
    }
    return list.map(item => fromString(item));
  });

/**
 * Increment variable stored in redis. if variable doesn't exist it will be created and set to 1
 * @param {String} key      key under which data will be incremented
 * @returns {Promise}
 */
const increment = key =>
  new Promise((resolve, reject) => {
    redisClient.incr(config.dataPrefix + key, err => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });

/**
 * Find keys matched by pattern and remove them from redis data storage
 * @param {String} pattern  pattern for keys. i.e. example.com* will remove all keys starts from example.com
 * @returns {Promise}
 */
const cleanByKeyPattern = pattern =>
  new Promise((resolve, reject) => {
    getKeysByPattern(pattern)
      .then(keys => {
        if (keys.length === 0) {
          return resolve();
        }
        redisClient.del(keys, err => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      })
      .catch(reject);
  });

/**
 * Find keys matched by pattern
 * @param {String} pattern          pattern for keys. i.e. example.com* will get all keys starts from example.com
 * @param {Boolean} [clean = false] define return keys with config.dataPrefix or not
 * @returns {Promise}
 */
const getKeysByPattern = (pattern, clean) =>
  new Promise((resolve, reject) => {
    redisClient.keys(config.dataPrefix + pattern, (err, keys) => {
      if (err) {
        reject(err);
        return;
      }
      if (clean) {
        resolve(keys.map(key => key.replace(config.dataPrefix, '')));
      } else {
        resolve(keys);
      }
    });
  });

const expire = (key, seconds) => {
  redisClient.expire(config.dataPrefix + key, +seconds);
  return Promise.resolve();
};

/**
 * Remove key from Redis
 */
const remove = key =>
  new Promise((resolve, reject) => {
    redisClient.del(key, (err, res) => {
      err ? reject(err) : resolve(res);
    });
  });

/**
 * Save value in redis set
 * @param set Set name
 * @param value Value
 * @returns {Promise}
 */
const saveSetValue = (set, value) =>
  new Promise((resolve, reject) => {
    redisClient.sadd(set, value, (err, res) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(res);
    });
  });

const removeSetValue = (set, value) =>
  new Promise((resolve, reject) => {
    redisClient.srem(set, value, (err, res) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(res);
    });
  });

const deleteKey = key =>
  new Promise((resolve, reject) => {
    redisClient.del(`${config.dataPrefix}${key}`, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });

/**
 * Check if value exists in set
 * @param set Set name
 * @param value Value
 * @returns {Promise}
 */
const isValueExistsInSet = (set, value) =>
  new Promise((resolve, reject) => {
    redisClient.sismember(set, value, (err, res) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(res !== 0);
    });
  });

const getInfo = () =>
  new Promise((resolve, reject) => {
    redisClient.info(err => {
      if (err) {
        reject(err);
        return;
      }
      return resolve(redisClient.server_info);
    });
  });

const deleteKeysByPattern = pattern => {
  let total = 0;
  return new Promise((resolve, reject) => {
    let scanAsync = cursor =>
      redisClient.scan(
        cursor,
        'MATCH',
        `${prefix}*${pattern}`,
        'COUNT',
        '10000',
        (err, response) => {
          if (err) {
            reject(err);
            return;
          }
          let newCursor = response[0];
          let keys = response[1];
          if (keys.length !== 0) {
            total += keys.length;

            redisClient.del(keys, error => {
              if (error) {
                console.log('ERR on DELETING KEY', error);
              }
            });
          }
          if (newCursor === '0') {
            console.log('Total deleted countyip keys - ', total);
            resolve();
            return;
          }
          scanAsync(newCursor);
        }
      );
    scanAsync('0');
  });
};

/**
 * Get Redis connection instance
 */
const getClient = () => redisClient;

const isClientReady = () => redisReady;

module.exports = {
  initialize,
  _get,
  _set,
  setValue,
  getValue,
  setObject,
  getObject,
  setList,
  getList,
  increment,
  remove,
  cleanByKeyPattern,
  getKeysByPattern,
  expire,
  getInfo,
  getClient,
  isKeyExist,
  getPubSubRedisClient,
  saveSetValue,
  removeSetValue,
  deleteKey,
  isValueExistsInSet,
  deleteKeysByPattern,
  isClientReady,
};
