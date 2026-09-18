(function (root, factory) {
  var defaults = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = defaults;
  }

  if (root) {
    root.QUANTUM_DEFAULT_PROGRAMS = defaults;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  return [];
});
