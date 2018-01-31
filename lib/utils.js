function mergeObjects(obj, target) {
  if (!obj || !target) {
    return {};
  }
  const sourceObj = Object.keys(target)
    .filter(key => Boolean(target[key]))
    .reduce((acc, key) => {
      acc[key] = target[key];
      return acc;
    }, {});
  return Object.assign({}, obj, sourceObj);
}

function fromString(item) {
  if (item === 'undefined') {
    return undefined;
  }
  if (isEmpty(item)) {
    return null;
  }
  if (isNaN(item)) {
    return item;
  }
  let f = parseFloat(item);
  let i = parseInt(item, 10);
  return i === f ? i : f;
}


function isEmpty(variable) {
  return !variable || variable === 'null' || variable === 'undefined';
}


module.exports = {
  mergeObjects,
  fromString,
  isEmpty
};
