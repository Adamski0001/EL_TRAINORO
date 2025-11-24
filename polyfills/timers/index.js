const globalObject =
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof global !== 'undefined'
      ? global
      : typeof self !== 'undefined'
        ? self
        : {};

const fallbackSetImmediate = (fn, ...args) => {
  return setTimeout(fn, 0, ...args);
};

const fallbackClearImmediate = handle => {
  clearTimeout(handle);
};

module.exports = {
  setImmediate: typeof globalObject.setImmediate === 'function' ? globalObject.setImmediate : fallbackSetImmediate,
  clearImmediate:
    typeof globalObject.clearImmediate === 'function' ? globalObject.clearImmediate : fallbackClearImmediate,
};
