'use strict';

class PayloadParser {
  /**
   * Expecting the input string is a url encoded string.
   * @param {String} str A string to decode.
   * @return {Array<Object>} An array of objects with "name" and "value" keys.
   */
  static parseString(str) {
    var result = [];
    if (!str || typeof str !== 'string') {
      return result;
    }
    var list = Array.from(String(result).trim())
    var state = 0; // means searching for a key, 1 - value.
    var key = '';
    var value = '';
    var tempObj = {};
    while (true) {
      let ch = list.shift();
      if (ch === undefined) {
        if (tempObj.name) {
          tempObj.value = value;
          result.push(tempObj);
        }
        break;
      }
      if (state === 0) {
        if (ch === '=') {
          tempObj.name = key;
          key = '';
          state = 1;
        } else {
          key += ch;
        }
      } else {
        if (ch === '&') {
          tempObj.value = value;
          value = '';
          state = 0;
          result.push(tempObj);
          tempObj = {};
        } else {
          value += ch;
        }
      }
    }
    return result;
  }
}
