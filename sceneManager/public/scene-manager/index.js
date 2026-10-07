var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

// node_modules/ot-json0/lib/bootstrapTransform.js
var require_bootstrapTransform = __commonJS((exports, module) => {
  module.exports = bootstrapTransform;
  function bootstrapTransform(type, transformComponent, checkValidOp, append) {
    var transformComponentX = function(left, right, destLeft, destRight) {
      transformComponent(destLeft, left, right, "left");
      transformComponent(destRight, right, left, "right");
    };
    var transformX = type.transformX = function(leftOp, rightOp) {
      checkValidOp(leftOp);
      checkValidOp(rightOp);
      var newRightOp = [];
      for (var i = 0;i < rightOp.length; i++) {
        var rightComponent = rightOp[i];
        var newLeftOp = [];
        var k = 0;
        while (k < leftOp.length) {
          var nextC = [];
          transformComponentX(leftOp[k], rightComponent, newLeftOp, nextC);
          k++;
          if (nextC.length === 1) {
            rightComponent = nextC[0];
          } else if (nextC.length === 0) {
            for (var j = k;j < leftOp.length; j++) {
              append(newLeftOp, leftOp[j]);
            }
            rightComponent = null;
            break;
          } else {
            var pair = transformX(leftOp.slice(k), nextC);
            for (var l = 0;l < pair[0].length; l++) {
              append(newLeftOp, pair[0][l]);
            }
            for (var r = 0;r < pair[1].length; r++) {
              append(newRightOp, pair[1][r]);
            }
            rightComponent = null;
            break;
          }
        }
        if (rightComponent != null) {
          append(newRightOp, rightComponent);
        }
        leftOp = newLeftOp;
      }
      return [leftOp, newRightOp];
    };
    type.transform = function(op, otherOp, type2) {
      if (!(type2 === "left" || type2 === "right"))
        throw new Error("type must be 'left' or 'right'");
      if (otherOp.length === 0)
        return op;
      if (op.length === 1 && otherOp.length === 1)
        return transformComponent([], op[0], otherOp[0], type2);
      if (type2 === "left")
        return transformX(op, otherOp)[0];
      else
        return transformX(otherOp, op)[1];
    };
  }
});

// node_modules/ot-json0/lib/text0.js
var require_text0 = __commonJS((exports, module) => {
  var text = module.exports = {
    name: "text0",
    uri: "http://sharejs.org/types/textv0",
    create: function(initial) {
      if (initial != null && typeof initial !== "string") {
        throw new Error("Initial data must be a string");
      }
      return initial || "";
    }
  };
  var strInject = function(s1, pos, s2) {
    return s1.slice(0, pos) + s2 + s1.slice(pos);
  };
  var checkValidComponent = function(c) {
    if (typeof c.p !== "number")
      throw new Error("component missing position field");
    if (typeof c.i === "string" === (typeof c.d === "string"))
      throw new Error("component needs an i or d field");
    if (c.p < 0)
      throw new Error("position cannot be negative");
  };
  var checkValidOp = function(op) {
    for (var i = 0;i < op.length; i++) {
      checkValidComponent(op[i]);
    }
  };
  text.apply = function(snapshot, op) {
    var deleted;
    checkValidOp(op);
    for (var i = 0;i < op.length; i++) {
      var component = op[i];
      if (component.i != null) {
        snapshot = strInject(snapshot, component.p, component.i);
      } else {
        deleted = snapshot.slice(component.p, component.p + component.d.length);
        if (component.d !== deleted)
          throw new Error("Delete component '" + component.d + "' does not match deleted text '" + deleted + "'");
        snapshot = snapshot.slice(0, component.p) + snapshot.slice(component.p + component.d.length);
      }
    }
    return snapshot;
  };
  var append = text._append = function(newOp, c) {
    if (c.i === "" || c.d === "")
      return;
    if (newOp.length === 0) {
      newOp.push(c);
    } else {
      var last = newOp[newOp.length - 1];
      if (last.i != null && c.i != null && last.p <= c.p && c.p <= last.p + last.i.length) {
        newOp[newOp.length - 1] = { i: strInject(last.i, c.p - last.p, c.i), p: last.p };
      } else if (last.d != null && c.d != null && c.p <= last.p && last.p <= c.p + c.d.length) {
        newOp[newOp.length - 1] = { d: strInject(c.d, last.p - c.p, last.d), p: c.p };
      } else {
        newOp.push(c);
      }
    }
  };
  text.compose = function(op1, op2) {
    checkValidOp(op1);
    checkValidOp(op2);
    var newOp = op1.slice();
    for (var i = 0;i < op2.length; i++) {
      append(newOp, op2[i]);
    }
    return newOp;
  };
  text.normalize = function(op) {
    var newOp = [];
    if (op.i != null || op.p != null)
      op = [op];
    for (var i = 0;i < op.length; i++) {
      var c = op[i];
      if (c.p == null)
        c.p = 0;
      append(newOp, c);
    }
    return newOp;
  };
  var transformPosition = function(pos, c, insertAfter) {
    if (c.i != null) {
      if (c.p < pos || c.p === pos && insertAfter) {
        return pos + c.i.length;
      } else {
        return pos;
      }
    } else {
      if (pos <= c.p) {
        return pos;
      } else if (pos <= c.p + c.d.length) {
        return c.p;
      } else {
        return pos - c.d.length;
      }
    }
  };
  text.transformCursor = function(position, op, side) {
    var insertAfter = side === "right";
    for (var i = 0;i < op.length; i++) {
      position = transformPosition(position, op[i], insertAfter);
    }
    return position;
  };
  var transformComponent = text._tc = function(dest, c, otherC, side) {
    checkValidComponent(c);
    checkValidComponent(otherC);
    if (c.i != null) {
      append(dest, { i: c.i, p: transformPosition(c.p, otherC, side === "right") });
    } else {
      if (otherC.i != null) {
        var s = c.d;
        if (c.p < otherC.p) {
          append(dest, { d: s.slice(0, otherC.p - c.p), p: c.p });
          s = s.slice(otherC.p - c.p);
        }
        if (s !== "")
          append(dest, { d: s, p: c.p + otherC.i.length });
      } else {
        if (c.p >= otherC.p + otherC.d.length)
          append(dest, { d: c.d, p: c.p - otherC.d.length });
        else if (c.p + c.d.length <= otherC.p)
          append(dest, c);
        else {
          var newC = { d: "", p: c.p };
          if (c.p < otherC.p)
            newC.d = c.d.slice(0, otherC.p - c.p);
          if (c.p + c.d.length > otherC.p + otherC.d.length)
            newC.d += c.d.slice(otherC.p + otherC.d.length - c.p);
          var intersectStart = Math.max(c.p, otherC.p);
          var intersectEnd = Math.min(c.p + c.d.length, otherC.p + otherC.d.length);
          var cIntersect = c.d.slice(intersectStart - c.p, intersectEnd - c.p);
          var otherIntersect = otherC.d.slice(intersectStart - otherC.p, intersectEnd - otherC.p);
          if (cIntersect !== otherIntersect)
            throw new Error("Delete ops delete different text in the same region of the document");
          if (newC.d !== "") {
            newC.p = transformPosition(newC.p, otherC);
            append(dest, newC);
          }
        }
      }
    }
    return dest;
  };
  var invertComponent = function(c) {
    return c.i != null ? { d: c.i, p: c.p } : { i: c.d, p: c.p };
  };
  text.invert = function(op) {
    op = op.slice().reverse();
    for (var i = 0;i < op.length; i++) {
      op[i] = invertComponent(op[i]);
    }
    return op;
  };
  require_bootstrapTransform()(text, transformComponent, checkValidOp, append);
});

// node_modules/ot-json0/lib/json0.js
var require_json0 = __commonJS((exports, module) => {
  var isArray = function(obj) {
    return Object.prototype.toString.call(obj) == "[object Array]";
  };
  var isObject = function(obj) {
    return !!obj && obj.constructor === Object;
  };
  var clone = function(o) {
    return JSON.parse(JSON.stringify(o));
  };
  var json = {
    name: "json0",
    uri: "http://sharejs.org/types/JSONv0"
  };
  var subtypes = {};
  json.registerSubtype = function(subtype) {
    subtypes[subtype.name] = subtype;
  };
  json.create = function(data) {
    return data === undefined ? null : clone(data);
  };
  json.invertComponent = function(c) {
    var c_ = { p: c.p };
    if (c.t && subtypes[c.t]) {
      c_.t = c.t;
      c_.o = subtypes[c.t].invert(c.o);
    }
    if (c.si !== undefined)
      c_.sd = c.si;
    if (c.sd !== undefined)
      c_.si = c.sd;
    if (c.oi !== undefined)
      c_.od = c.oi;
    if (c.od !== undefined)
      c_.oi = c.od;
    if (c.li !== undefined)
      c_.ld = c.li;
    if (c.ld !== undefined)
      c_.li = c.ld;
    if (c.na !== undefined)
      c_.na = -c.na;
    if (c.lm !== undefined) {
      c_.lm = c.p[c.p.length - 1];
      c_.p = c.p.slice(0, c.p.length - 1).concat([c.lm]);
    }
    return c_;
  };
  json.invert = function(op) {
    var op_ = op.slice().reverse();
    var iop = [];
    for (var i = 0;i < op_.length; i++) {
      iop.push(json.invertComponent(op_[i]));
    }
    return iop;
  };
  json.checkValidOp = function(op) {
    for (var i = 0;i < op.length; i++) {
      if (!isArray(op[i].p))
        throw new Error("Missing path");
    }
  };
  json.checkList = function(elem) {
    if (!isArray(elem))
      throw new Error("Referenced element not a list");
  };
  json.checkObj = function(elem) {
    if (!isObject(elem)) {
      throw new Error("Referenced element not an object (it was " + JSON.stringify(elem) + ")");
    }
  };
  function convertFromText(c) {
    c.t = "text0";
    var o = { p: c.p.pop() };
    if (c.si != null)
      o.i = c.si;
    if (c.sd != null)
      o.d = c.sd;
    c.o = [o];
  }
  function convertToText(c) {
    c.p.push(c.o[0].p);
    if (c.o[0].i != null)
      c.si = c.o[0].i;
    if (c.o[0].d != null)
      c.sd = c.o[0].d;
    delete c.t;
    delete c.o;
  }
  json.apply = function(snapshot, op) {
    json.checkValidOp(op);
    op = clone(op);
    var container = {
      data: snapshot
    };
    for (var i = 0;i < op.length; i++) {
      var c = op[i];
      if (c.si != null || c.sd != null)
        convertFromText(c);
      var parent = null;
      var parentKey = null;
      var elem = container;
      var key = "data";
      for (var j = 0;j < c.p.length; j++) {
        var p = c.p[j];
        parent = elem;
        parentKey = key;
        elem = elem[key];
        key = p;
        if (parent == null)
          throw new Error("Path invalid");
      }
      if (c.t && c.o !== undefined && subtypes[c.t]) {
        elem[key] = subtypes[c.t].apply(elem[key], c.o);
      } else if (c.na !== undefined) {
        if (typeof elem[key] != "number")
          throw new Error("Referenced element not a number");
        elem[key] += c.na;
      } else if (c.li !== undefined && c.ld !== undefined) {
        json.checkList(elem);
        elem[key] = c.li;
      } else if (c.li !== undefined) {
        json.checkList(elem);
        elem.splice(key, 0, c.li);
      } else if (c.ld !== undefined) {
        json.checkList(elem);
        elem.splice(key, 1);
      } else if (c.lm !== undefined) {
        json.checkList(elem);
        if (c.lm != key) {
          var e = elem[key];
          elem.splice(key, 1);
          elem.splice(c.lm, 0, e);
        }
      } else if (c.oi !== undefined) {
        json.checkObj(elem);
        elem[key] = c.oi;
      } else if (c.od !== undefined) {
        json.checkObj(elem);
        delete elem[key];
      } else {
        throw new Error("invalid / missing instruction in op");
      }
    }
    return container.data;
  };
  json.shatter = function(op) {
    var results = [];
    for (var i = 0;i < op.length; i++) {
      results.push([op[i]]);
    }
    return results;
  };
  json.incrementalApply = function(snapshot, op, _yield) {
    for (var i = 0;i < op.length; i++) {
      var smallOp = [op[i]];
      snapshot = json.apply(snapshot, smallOp);
      _yield(smallOp, snapshot);
    }
    return snapshot;
  };
  var pathMatches = json.pathMatches = function(p1, p2, ignoreLast) {
    if (p1.length != p2.length)
      return false;
    for (var i = 0;i < p1.length; i++) {
      if (p1[i] !== p2[i] && (!ignoreLast || i !== p1.length - 1))
        return false;
    }
    return true;
  };
  json.append = function(dest, c) {
    c = clone(c);
    if (dest.length === 0) {
      dest.push(c);
      return;
    }
    var last = dest[dest.length - 1];
    if ((c.si != null || c.sd != null) && (last.si != null || last.sd != null)) {
      convertFromText(c);
      convertFromText(last);
    }
    if (pathMatches(c.p, last.p)) {
      if (c.t && last.t && c.t === last.t && subtypes[c.t]) {
        last.o = subtypes[c.t].compose(last.o, c.o);
        if (c.si != null || c.sd != null) {
          var p = c.p;
          for (var i = 0;i < last.o.length - 1; i++) {
            c.o = [last.o.pop()];
            c.p = p.slice();
            convertToText(c);
            dest.push(c);
          }
          convertToText(last);
        }
      } else if (last.na != null && c.na != null) {
        dest[dest.length - 1] = { p: last.p, na: last.na + c.na };
      } else if (last.li !== undefined && c.li === undefined && c.ld === last.li) {
        if (last.ld !== undefined) {
          delete last.li;
        } else {
          dest.pop();
        }
      } else if (last.od !== undefined && last.oi === undefined && c.oi !== undefined && c.od === undefined) {
        last.oi = c.oi;
      } else if (last.oi !== undefined && c.od !== undefined) {
        if (c.oi !== undefined) {
          last.oi = c.oi;
        } else if (last.od !== undefined) {
          delete last.oi;
        } else {
          dest.pop();
        }
      } else if (c.lm !== undefined && c.p[c.p.length - 1] === c.lm) {} else {
        dest.push(c);
      }
    } else {
      if ((c.si != null || c.sd != null) && (last.si != null || last.sd != null)) {
        convertToText(c);
        convertToText(last);
      }
      dest.push(c);
    }
  };
  json.compose = function(op1, op2) {
    json.checkValidOp(op1);
    json.checkValidOp(op2);
    var newOp = clone(op1);
    for (var i = 0;i < op2.length; i++) {
      json.append(newOp, op2[i]);
    }
    return newOp;
  };
  json.normalize = function(op) {
    var newOp = [];
    op = isArray(op) ? op : [op];
    for (var i = 0;i < op.length; i++) {
      var c = op[i];
      if (c.p == null)
        c.p = [];
      json.append(newOp, c);
    }
    return newOp;
  };
  json.commonLengthForOps = function(a, b) {
    var alen = a.p.length;
    var blen = b.p.length;
    if (a.na != null || a.t)
      alen++;
    if (b.na != null || b.t)
      blen++;
    if (alen === 0)
      return -1;
    if (blen === 0)
      return null;
    alen--;
    blen--;
    for (var i = 0;i < alen; i++) {
      var p = a.p[i];
      if (i >= blen || p !== b.p[i])
        return null;
    }
    return alen;
  };
  json.canOpAffectPath = function(op, path) {
    return json.commonLengthForOps({ p: path }, op) != null;
  };
  json.transformComponent = function(dest, c, otherC, type) {
    c = clone(c);
    var common = json.commonLengthForOps(otherC, c);
    var common2 = json.commonLengthForOps(c, otherC);
    var cplength = c.p.length;
    var otherCplength = otherC.p.length;
    if (c.na != null || c.t)
      cplength++;
    if (otherC.na != null || otherC.t)
      otherCplength++;
    if (common2 != null && otherCplength > cplength && c.p[common2] == otherC.p[common2]) {
      if (c.ld !== undefined) {
        var oc = clone(otherC);
        oc.p = oc.p.slice(cplength);
        c.ld = json.apply(clone(c.ld), [oc]);
      } else if (c.od !== undefined) {
        var oc = clone(otherC);
        oc.p = oc.p.slice(cplength);
        c.od = json.apply(clone(c.od), [oc]);
      }
    }
    if (common != null) {
      var commonOperand = cplength == otherCplength;
      var oc = otherC;
      if ((c.si != null || c.sd != null) && (otherC.si != null || otherC.sd != null)) {
        convertFromText(c);
        oc = clone(otherC);
        convertFromText(oc);
      }
      if (oc.t && subtypes[oc.t]) {
        if (c.t && c.t === oc.t) {
          var res = subtypes[c.t].transform(c.o, oc.o, type);
          if (c.si != null || c.sd != null) {
            var p = c.p;
            for (var i = 0;i < res.length; i++) {
              c.o = [res[i]];
              c.p = p.slice();
              convertToText(c);
              json.append(dest, c);
            }
          } else if (!isArray(res) || res.length > 0) {
            c.o = res;
            json.append(dest, c);
          }
          return dest;
        }
      } else if (otherC.na !== undefined) {} else if (otherC.li !== undefined && otherC.ld !== undefined) {
        if (otherC.p[common] === c.p[common]) {
          if (!commonOperand) {
            return dest;
          } else if (c.ld !== undefined) {
            if (c.li !== undefined && type === "left") {
              c.ld = clone(otherC.li);
            } else {
              return dest;
            }
          }
        }
      } else if (otherC.li !== undefined) {
        if (c.li !== undefined && c.ld === undefined && commonOperand && c.p[common] === otherC.p[common]) {
          if (type === "right")
            c.p[common]++;
        } else if (otherC.p[common] <= c.p[common]) {
          c.p[common]++;
        }
        if (c.lm !== undefined) {
          if (commonOperand) {
            if (otherC.p[common] <= c.lm)
              c.lm++;
          }
        }
      } else if (otherC.ld !== undefined) {
        if (c.lm !== undefined) {
          if (commonOperand) {
            if (otherC.p[common] === c.p[common]) {
              return dest;
            }
            var p = otherC.p[common];
            var from = c.p[common];
            var to = c.lm;
            if (p < to || p === to && from < to)
              c.lm--;
          }
        }
        if (otherC.p[common] < c.p[common]) {
          c.p[common]--;
        } else if (otherC.p[common] === c.p[common]) {
          if (otherCplength < cplength) {
            return dest;
          } else if (c.ld !== undefined) {
            if (c.li !== undefined) {
              delete c.ld;
            } else {
              return dest;
            }
          }
        }
      } else if (otherC.lm !== undefined) {
        if (c.lm !== undefined && cplength === otherCplength) {
          var from = c.p[common];
          var to = c.lm;
          var otherFrom = otherC.p[common];
          var otherTo = otherC.lm;
          if (otherFrom !== otherTo) {
            if (from === otherFrom) {
              if (type === "left") {
                c.p[common] = otherTo;
                if (from === to)
                  c.lm = otherTo;
              } else {
                return dest;
              }
            } else {
              if (from > otherFrom)
                c.p[common]--;
              if (from > otherTo)
                c.p[common]++;
              else if (from === otherTo) {
                if (otherFrom > otherTo) {
                  c.p[common]++;
                  if (from === to)
                    c.lm++;
                }
              }
              if (to > otherFrom) {
                c.lm--;
              } else if (to === otherFrom) {
                if (to > from)
                  c.lm--;
              }
              if (to > otherTo) {
                c.lm++;
              } else if (to === otherTo) {
                if (otherTo > otherFrom && to > from || otherTo < otherFrom && to < from) {
                  if (type === "right")
                    c.lm++;
                } else {
                  if (to > from)
                    c.lm++;
                  else if (to === otherFrom)
                    c.lm--;
                }
              }
            }
          }
        } else if (c.li !== undefined && c.ld === undefined && commonOperand) {
          var from = otherC.p[common];
          var to = otherC.lm;
          p = c.p[common];
          if (p > from)
            c.p[common]--;
          if (p > to)
            c.p[common]++;
        } else {
          var from = otherC.p[common];
          var to = otherC.lm;
          p = c.p[common];
          if (p === from) {
            c.p[common] = to;
          } else {
            if (p > from)
              c.p[common]--;
            if (p > to)
              c.p[common]++;
            else if (p === to && from > to)
              c.p[common]++;
          }
        }
      } else if (otherC.oi !== undefined && otherC.od !== undefined) {
        if (c.p[common] === otherC.p[common]) {
          if (c.oi !== undefined && commonOperand) {
            if (type === "right") {
              return dest;
            } else {
              c.od = otherC.oi;
            }
          } else {
            return dest;
          }
        }
      } else if (otherC.oi !== undefined) {
        if (c.oi !== undefined && c.p[common] === otherC.p[common]) {
          if (type === "left") {
            json.append(dest, { p: c.p, od: otherC.oi });
          } else {
            return dest;
          }
        }
      } else if (otherC.od !== undefined) {
        if (c.p[common] == otherC.p[common]) {
          if (!commonOperand)
            return dest;
          if (c.oi !== undefined) {
            delete c.od;
          } else {
            return dest;
          }
        }
      }
    }
    json.append(dest, c);
    return dest;
  };
  require_bootstrapTransform()(json, json.transformComponent, json.checkValidOp, json.append);
  var text = require_text0();
  json.registerSubtype(text);
  module.exports = json;
});

// node_modules/ot-json0/lib/index.js
var require_lib = __commonJS((exports, module) => {
  module.exports = {
    type: require_json0()
  };
});

// public/scene-manager/alert-timeline.ts
var UNTIMED_ALERT_MS = 5000;
var SUBSCRIBE_TIMEOUT_MS = 1e4;
var MAX_ALERT_MS = 5 * 60000;

class AlertTimeline {
  startedAt;
  widgets = new Map;
  anyTimed = false;
  constructor(widgetIds, startedAt) {
    this.startedAt = startedAt;
    for (const id of widgetIds) {
      this.widgets.set(id, "loading");
    }
  }
  subscribed(widgetId, timed) {
    if (this.widgets.get(widgetId) !== "loading") {
      return;
    }
    this.widgets.set(widgetId, timed ? "playing" : "untimed");
    if (timed) {
      this.anyTimed = true;
    }
  }
  completed(widgetId) {
    if (this.widgets.get(widgetId) === "playing") {
      this.widgets.set(widgetId, "done");
    }
  }
  isOver(now) {
    const elapsed = now - this.startedAt;
    if (elapsed >= MAX_ALERT_MS) {
      return true;
    }
    for (const state of this.widgets.values()) {
      if (state === "playing") {
        return false;
      }
      if (state === "loading" && elapsed < SUBSCRIBE_TIMEOUT_MS) {
        return false;
      }
    }
    return this.anyTimed || elapsed >= UNTIMED_ALERT_MS;
  }
}

// ../shared/clients/typescript/module-sdk/dist/widget-bindings.js
var URL_ATTRIBUTES = ["src", "href", "poster"];
var ELEMENT_SELECTOR = ["[data-setting]", ...URL_ATTRIBUTES.map((a) => `[data-setting-${a}]`)].join(", ");
// ../shared/clients/typescript/module-sdk/dist/widget-protocol.js
var WIDGET_PROTOCOL = "woofx3.widget";
var PROTOCOL_VERSION = 1;
var WIDGET_BOOT_FRAGMENT_PARAM = "boot";
function encodePlacementBoot(boot) {
  const bytes = new TextEncoder().encode(JSON.stringify(boot));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${WIDGET_BOOT_FRAGMENT_PARAM}=${base64}`;
}
function isWidgetProtocolEnvelope(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const msg = value;
  return msg.proto === WIDGET_PROTOCOL && msg.v === PROTOCOL_VERSION && typeof msg.type === "string" && msg.type.length > 0 && typeof msg.nonce === "string" && msg.nonce.length > 0;
}
// public/scene-manager/widget-bridge.ts
class WidgetBridge {
  instanceId;
  nonce;
  callbacks;
  iframe = null;
  moduleId = null;
  initialized = false;
  shimStorageSubs = new Map;
  shimSubToKey = new Map;
  shimEventSubs = new Set;
  readKeys = new Set;
  readAll = false;
  constructor(instanceId, nonce, callbacks) {
    this.instanceId = instanceId;
    this.nonce = nonce;
    this.callbacks = callbacks;
  }
  attach(iframe) {
    this.iframe = iframe;
  }
  onFrameLoad() {
    this.initialized = false;
    this.moduleId = null;
    this.readKeys.clear();
    this.readAll = false;
    this.shimStorageSubs.clear();
    this.shimSubToKey.clear();
    this.shimEventSubs.clear();
  }
  handleMessage(event) {
    if (!this.iframe || event.source !== this.iframe.contentWindow) {
      return;
    }
    const data = event.data;
    if (typeof data !== "object" || data === null) {
      return;
    }
    const msg = data;
    if (msg.proto !== WIDGET_PROTOCOL) {
      return;
    }
    if (msg.nonce !== this.nonce) {
      return;
    }
    const type = typeof msg.type === "string" ? msg.type : "";
    if (!type) {
      return;
    }
    if (type === "hello") {
      const v = msg.v;
      const incomingModuleId = typeof msg.moduleId === "string" ? msg.moduleId : "";
      if (v !== PROTOCOL_VERSION) {
        this.sendReject(`unsupported protocol version ${v}`);
        return;
      }
      this.moduleId = incomingModuleId;
      this.initialized = true;
      this.sendInit({});
      return;
    }
    if (!isWidgetProtocolEnvelope(data)) {
      return;
    }
    switch (type) {
      case "storage.get": {
        if (!this.initialized || !this.moduleId) {
          return;
        }
        const id = typeof msg.id === "string" ? msg.id : "";
        const key = typeof msg.key === "string" ? msg.key : "";
        const value = this.callbacks.onStorageGet(this.moduleId, key);
        this.post({ type: "storage.value", id, key, value });
        return;
      }
      case "storage.subscribe": {
        if (!this.initialized || !this.moduleId) {
          return;
        }
        const key = typeof msg.key === "string" ? msg.key : "";
        const subId = typeof msg.subId === "string" ? msg.subId : "";
        const storageKey = `${this.moduleId}:${key}`;
        let subIds = this.shimStorageSubs.get(storageKey);
        if (!subIds) {
          subIds = new Set;
          this.shimStorageSubs.set(storageKey, subIds);
        }
        subIds.add(subId);
        this.shimSubToKey.set(subId, storageKey);
        this.callbacks.onStorageSubscribe(this.moduleId, key, this.instanceId);
        return;
      }
      case "storage.unsubscribe": {
        if (!this.initialized || !this.moduleId) {
          return;
        }
        const subId = typeof msg.subId === "string" ? msg.subId : "";
        const storageKey = this.shimSubToKey.get(subId);
        if (!storageKey) {
          return;
        }
        this.shimSubToKey.delete(subId);
        const subIds = this.shimStorageSubs.get(storageKey);
        if (subIds) {
          subIds.delete(subId);
          if (subIds.size === 0) {
            this.shimStorageSubs.delete(storageKey);
          }
        }
        const colonIdx = storageKey.indexOf(":");
        const key = colonIdx >= 0 ? storageKey.slice(colonIdx + 1) : storageKey;
        this.callbacks.onStorageUnsubscribe(this.moduleId, key, this.instanceId);
        return;
      }
      case "events.subscribe": {
        if (!this.initialized) {
          return;
        }
        const subId = typeof msg.subId === "string" ? msg.subId : "";
        if (!subId) {
          return;
        }
        this.shimEventSubs.add(subId);
        const queue = isEventQueueConfig(msg.queue) ? msg.queue : undefined;
        this.callbacks.onEventsSubscribe(subId, queue);
        return;
      }
      case "events.unsubscribe": {
        if (!this.initialized) {
          return;
        }
        const subId = typeof msg.subId === "string" ? msg.subId : "";
        this.shimEventSubs.delete(subId);
        this.callbacks.onEventsUnsubscribe(subId);
        return;
      }
      case "event.complete": {
        if (!this.initialized) {
          return;
        }
        const subId = typeof msg.subId === "string" ? msg.subId : "";
        const eventId = typeof msg.eventId === "string" ? msg.eventId : "";
        if (!subId || !eventId) {
          return;
        }
        this.callbacks.onEventComplete(subId, eventId);
        return;
      }
      case "settings.reads": {
        if (!this.initialized) {
          return;
        }
        if (msg.all === true) {
          this.readAll = true;
        }
        if (Array.isArray(msg.keys)) {
          for (const key of msg.keys) {
            if (typeof key === "string") {
              this.readKeys.add(key);
            }
          }
        }
        return;
      }
      case "rendered": {
        this.callbacks.onRendered?.();
        return;
      }
      case "status.report": {
        if (!this.initialized || !this.moduleId) {
          return;
        }
        this.callbacks.onStatusReport({
          moduleId: this.moduleId,
          instanceId: this.instanceId,
          key: typeof msg.key === "string" ? msg.key : "",
          value: msg.value,
          ts: typeof msg.ts === "string" ? msg.ts : new Date().toISOString()
        });
        return;
      }
      default:
        return;
    }
  }
  sendInit(settings) {
    this.post({
      type: "init",
      settings,
      capabilities: ["storage", "events", "status", "settings"]
    });
  }
  sendReject(reason) {
    this.post({
      type: "init.reject",
      reason,
      supportedVersions: [PROTOCOL_VERSION]
    });
  }
  sendStorageValue(key, value) {
    if (this.moduleId) {
      this.sendStorageChanged(this.moduleId, key, value);
    }
  }
  sendStorageChanged(moduleId, key, value) {
    if (!this.initialized) {
      return;
    }
    const storageKey = `${moduleId}:${key}`;
    const subIds = this.shimStorageSubs.get(storageKey);
    const occurredAt = new Date().toISOString();
    if (subIds && subIds.size > 0) {
      for (const subId of subIds) {
        this.post({ type: "storage.changed", subId, key, value, occurredAt });
      }
    } else {
      this.post({ type: "storage.changed", subId: storageKey, key, value, occurredAt });
    }
  }
  sendEvent(subId, event) {
    if (!this.initialized || !this.shimEventSubs.has(subId)) {
      return false;
    }
    this.post({ type: "event.deliver", subId, event });
    return true;
  }
  settingsReads() {
    return this.initialized ? { all: this.readAll, keys: this.readKeys } : null;
  }
  sendSettings(settings) {
    if (this.initialized) {
      this.post({ type: "settings.changed", settings });
    }
  }
  dispose() {
    this.post({ type: "dispose", reason: "scene-manager-dispose" });
    this.callbacks.onDispose();
  }
  detach() {
    this.iframe = null;
    this.initialized = false;
    this.moduleId = null;
    this.readKeys.clear();
    this.readAll = false;
    this.shimStorageSubs.clear();
    this.shimSubToKey.clear();
    this.shimEventSubs.clear();
  }
  post(payload) {
    const win = this.iframe?.contentWindow;
    if (!win) {
      return;
    }
    win.postMessage({
      proto: WIDGET_PROTOCOL,
      v: PROTOCOL_VERSION,
      nonce: this.nonce,
      ...payload
    }, "*");
  }
}
function isEventQueueConfig(value) {
  return typeof value === "object" && value !== null;
}
function createFrameLoadHandler(bridge) {
  let loadCount = 0;
  return () => {
    loadCount += 1;
    if (loadCount > 1) {
      bridge.onFrameLoad();
    }
  };
}

// public/scene-manager/alert-widget.ts
var TICK_MS = 250;

class AlertWidget {
  opts;
  playing = new Map;
  constructor(opts) {
    this.opts = opts;
  }
  stop(eventId) {
    this.playing.get(eventId)?.();
  }
  dispose() {
    for (const [eventId, tearDown] of [...this.playing]) {
      tearDown();
      this.opts.onFinished(eventId);
    }
  }
  play(item) {
    const delivery = parseDelivery(item.value);
    if (!delivery) {
      console.warn("[scene-manager] malformed alert delivery; skipping", { eventId: item.eventId });
      setTimeout(() => this.opts.onFinished(item.eventId), 0);
      return true;
    }
    this.run(item.eventId, delivery);
    return true;
  }
  run(eventId, delivery) {
    const { element, sceneBase, bridges } = this.opts;
    const { layout } = delivery;
    const stage = document.createElement("div");
    stage.className = "alert-stage";
    stage.style.width = `${layout.width}px`;
    stage.style.height = `${layout.height}px`;
    const scale = Math.min(element.clientWidth / layout.width, element.clientHeight / layout.height);
    const offsetX = (element.clientWidth - layout.width * scale) / 2;
    const offsetY = (element.clientHeight - layout.height * scale) / 2;
    stage.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    element.appendChild(stage);
    const timeline = new AlertTimeline(layout.widgets.map((widget) => widget.id), Date.now());
    const alertEvent = {
      type: "alert",
      source: "scene-manager",
      time: new Date().toISOString(),
      data: delivery.event,
      eventId
    };
    const children = [];
    for (const widget of layout.widgets) {
      const instanceId = `${eventId}.${widget.id}`;
      const nonce = this.opts.generateNonce();
      const iframe = document.createElement("iframe");
      iframe.className = "widget-frame";
      iframe.style.left = `${widget.position.x}px`;
      iframe.style.top = `${widget.position.y}px`;
      iframe.style.width = `${widget.position.width}px`;
      iframe.style.height = `${widget.position.height}px`;
      iframe.setAttribute("sandbox", "allow-scripts");
      const bridge = new WidgetBridge(instanceId, nonce, {
        onStorageGet: () => null,
        onStorageSubscribe: () => {},
        onStorageUnsubscribe: () => {},
        onStatusReport: (report) => this.opts.postStatus(instanceId, report),
        onEventsSubscribe: (subId, queue) => {
          timeline.subscribed(widget.id, queue?.autoComplete === false);
          bridge.sendEvent(subId, alertEvent);
        },
        onEventsUnsubscribe: () => {},
        onEventComplete: () => timeline.completed(widget.id),
        onDispose: () => {}
      });
      iframe.addEventListener("load", createFrameLoadHandler(bridge));
      iframe.src = `${sceneBase}/alert/${encodeURIComponent(eventId)}/widget/${encodeURIComponent(widget.id)}` + `?nonce=${encodeURIComponent(nonce)}`;
      bridges.add(bridge);
      stage.appendChild(iframe);
      bridge.attach(iframe);
      children.push(bridge);
    }
    const tearDown = () => {
      clearInterval(timer);
      this.playing.delete(eventId);
      for (const bridge of children) {
        bridge.dispose();
        bridge.detach();
        bridges.delete(bridge);
      }
      stage.remove();
    };
    const timer = setInterval(() => {
      if (!timeline.isOver(Date.now())) {
        return;
      }
      tearDown();
      this.opts.onFinished(eventId);
    }, TICK_MS);
    this.playing.set(eventId, tearDown);
  }
}
function parseDelivery(value) {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { layout, event } = value;
  if (!layout || !(layout.width > 0) || !(layout.height > 0) || !Array.isArray(layout.widgets)) {
    return null;
  }
  return { layout, event: event ?? null };
}

// public/scene-manager/resolver.ts
function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === `
` || c === "\r") {
      i += 1;
      continue;
    }
    if (c >= "0" && c <= "9" || c === "." && src[i + 1] >= "0" && src[i + 1] <= "9") {
      let j = i + 1;
      while (j < src.length && (src[j] >= "0" && src[j] <= "9" || src[j] === ".")) {
        j += 1;
      }
      out.push({ kind: "num", value: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < src.length) {
          const next = src[j + 1];
          s += next === "n" ? `
` : next === "t" ? "\t" : next === "r" ? "\r" : next;
          j += 2;
          continue;
        }
        s += src[j];
        j += 1;
      }
      if (j >= src.length) {
        throw new Error("unterminated string");
      }
      out.push({ kind: "str", value: s });
      i = j + 1;
      continue;
    }
    if (c >= "a" && c <= "z" || c >= "A" && c <= "Z" || c === "_" || c === "$") {
      let j = i + 1;
      while (j < src.length && (src[j] >= "a" && src[j] <= "z" || src[j] >= "A" && src[j] <= "Z" || src[j] >= "0" && src[j] <= "9" || src[j] === "_" || src[j] === "$")) {
        j += 1;
      }
      out.push({ kind: "ident", value: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    const three = src.slice(i, i + 3);
    if (three === "===" || three === "!==") {
      out.push({ kind: "punct", value: three });
      i += 3;
      continue;
    }
    if (two === "==" || two === "!=" || two === ">=" || two === "<=" || two === "&&" || two === "||") {
      out.push({ kind: "punct", value: two });
      i += 2;
      continue;
    }
    if ("+-*/%(),.[]?:!<>".includes(c)) {
      out.push({ kind: "punct", value: c });
      i += 1;
      continue;
    }
    throw new Error(`unexpected character: ${c}`);
  }
  return out;
}
function evaluateExpression(src, ctx) {
  let tokens;
  try {
    tokens = tokenize(src);
  } catch {
    return;
  }
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (kind, value) => {
    const t = tokens[pos];
    if (!t) {
      return null;
    }
    if (t.kind !== kind) {
      return null;
    }
    if (value !== undefined && t.value !== value) {
      return null;
    }
    pos += 1;
    return t;
  };
  const parseTernary = () => {
    const cond = parseOr();
    if (eat("punct", "?")) {
      const a = parseTernary();
      if (!eat("punct", ":")) {
        throw new Error("expected ':' in ternary");
      }
      const b = parseTernary();
      return cond ? a : b;
    }
    return cond;
  };
  const parseOr = () => {
    let left = parseAnd();
    while (eat("punct", "||")) {
      const right = parseAnd();
      left = left || right;
    }
    return left;
  };
  const parseAnd = () => {
    let left = parseEquality();
    while (eat("punct", "&&")) {
      const right = parseEquality();
      left = left && right;
    }
    return left;
  };
  const parseEquality = () => {
    let left = parseComparison();
    while (true) {
      const op = peek();
      if (!op || op.kind !== "punct") {
        break;
      }
      if (op.value === "==") {
        pos += 1;
        left = left == parseComparison();
      } else if (op.value === "!=") {
        pos += 1;
        left = left != parseComparison();
      } else if (op.value === "===") {
        pos += 1;
        left = left === parseComparison();
      } else if (op.value === "!==") {
        pos += 1;
        left = left !== parseComparison();
      } else {
        break;
      }
    }
    return left;
  };
  const parseComparison = () => {
    let left = parseAdditive();
    while (true) {
      const op = peek();
      if (!op || op.kind !== "punct") {
        break;
      }
      if (op.value === ">") {
        pos += 1;
        left = left > parseAdditive();
      } else if (op.value === "<") {
        pos += 1;
        left = left < parseAdditive();
      } else if (op.value === ">=") {
        pos += 1;
        left = left >= parseAdditive();
      } else if (op.value === "<=") {
        pos += 1;
        left = left <= parseAdditive();
      } else {
        break;
      }
    }
    return left;
  };
  const parseAdditive = () => {
    let left = parseMultiplicative();
    while (true) {
      const op = peek();
      if (!op || op.kind !== "punct") {
        break;
      }
      if (op.value === "+") {
        pos += 1;
        const right = parseMultiplicative();
        left = typeof left === "string" || typeof right === "string" ? `${left ?? ""}${right ?? ""}` : left + right;
      } else if (op.value === "-") {
        pos += 1;
        left = left - parseMultiplicative();
      } else {
        break;
      }
    }
    return left;
  };
  const parseMultiplicative = () => {
    let left = parseUnary();
    while (true) {
      const op = peek();
      if (!op || op.kind !== "punct") {
        break;
      }
      if (op.value === "*") {
        pos += 1;
        left = left * parseUnary();
      } else if (op.value === "/") {
        pos += 1;
        left = left / parseUnary();
      } else if (op.value === "%") {
        pos += 1;
        left = left % parseUnary();
      } else {
        break;
      }
    }
    return left;
  };
  const parseUnary = () => {
    if (eat("punct", "-")) {
      return -parseUnary();
    }
    if (eat("punct", "!")) {
      return !parseUnary();
    }
    return parsePrimary();
  };
  const parsePrimary = () => {
    const t = peek();
    if (!t) {
      throw new Error("unexpected end of expression");
    }
    if (t.kind === "num") {
      pos += 1;
      return t.value;
    }
    if (t.kind === "str") {
      pos += 1;
      return t.value;
    }
    if (t.kind === "punct" && t.value === "(") {
      pos += 1;
      const v = parseTernary();
      if (!eat("punct", ")")) {
        throw new Error("expected ')'");
      }
      return v;
    }
    if (t.kind === "ident") {
      pos += 1;
      if (t.value === "true") {
        return true;
      }
      if (t.value === "false") {
        return false;
      }
      if (t.value === "null") {
        return null;
      }
      if (t.value === "undefined") {
        return;
      }
      let cur = ctx[t.value];
      while (true) {
        if (eat("punct", ".")) {
          const name = eat("ident");
          if (!name) {
            throw new Error("expected identifier after '.'");
          }
          cur = cur == null ? undefined : cur[name.value];
          continue;
        }
        if (eat("punct", "[")) {
          const idx = parseTernary();
          if (!eat("punct", "]")) {
            throw new Error("expected ']'");
          }
          cur = cur == null ? undefined : cur[idx];
          continue;
        }
        break;
      }
      return cur;
    }
    throw new Error(`unexpected token: ${JSON.stringify(t)}`);
  };
  try {
    const result = parseTernary();
    if (pos !== tokens.length) {
      throw new Error("trailing tokens");
    }
    return result;
  } catch {
    return;
  }
}

// public/scene-manager/event-queue.ts
var DEFAULT_MAX_IN_FLIGHT = 1;
var REMEMBERED_FINISHED_EVENTS = 256;

class InstanceQueue {
  config;
  deliver;
  onTimeout;
  onCancel;
  pending = [];
  inFlight = new Map;
  finished = new Set;
  constructor(config, deliver, onTimeout, onCancel) {
    this.config = config;
    this.deliver = deliver;
    this.onTimeout = onTimeout;
    this.onCancel = onCancel;
  }
  enqueue(item) {
    if (this.inFlight.has(item.eventId) || this.finished.has(item.eventId) || this.pending.some((pending) => pending.eventId === item.eventId)) {
      return;
    }
    const priority = this.priorityOf(item);
    const entry = { ...item, priority };
    if (!this.config.priorityExpr) {
      this.pending.push(entry);
    } else {
      let i = 0;
      while (i < this.pending.length && this.pending[i].priority >= priority) {
        i += 1;
      }
      this.pending.splice(i, 0, entry);
    }
    this.pump();
  }
  complete(eventId) {
    const timer = this.inFlight.get(eventId);
    if (timer) {
      clearTimeout(timer);
    }
    if (this.inFlight.delete(eventId)) {
      this.rememberFinished(eventId);
      this.pump();
    }
  }
  cancel(eventIds) {
    const cancelled = new Set(eventIds);
    for (let i = this.pending.length - 1;i >= 0; i -= 1) {
      if (cancelled.has(this.pending[i].eventId)) {
        this.pending.splice(i, 1);
      }
    }
    for (const eventId of cancelled) {
      if (this.inFlight.has(eventId)) {
        const timer = this.inFlight.get(eventId);
        if (timer) {
          clearTimeout(timer);
        }
        this.inFlight.delete(eventId);
        this.onCancel(eventId);
      }
      this.rememberFinished(eventId);
    }
    this.pump();
  }
  size() {
    return this.pending.length + this.inFlight.size;
  }
  priorityOf(item) {
    if (!this.config.priorityExpr) {
      return 0;
    }
    const result = evaluateExpression(this.config.priorityExpr, {
      type: item.type,
      key: item.key,
      value: item.value
    });
    return typeof result === "number" && Number.isFinite(result) ? result : 0;
  }
  pump() {
    const maxInFlight = this.config.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT;
    while (this.inFlight.size < maxInFlight && this.pending.length > 0) {
      const item = this.pending.shift();
      const delivered = this.deliver(item);
      if (!delivered) {
        continue;
      }
      let timer = null;
      if (this.config.retryTimeoutMs) {
        timer = setTimeout(() => {
          this.inFlight.delete(item.eventId);
          this.rememberFinished(item.eventId);
          this.onTimeout(item.eventId);
          this.pump();
        }, this.config.retryTimeoutMs);
      }
      this.inFlight.set(item.eventId, timer);
    }
  }
  rememberFinished(eventId) {
    this.finished.add(eventId);
    if (this.finished.size > REMEMBERED_FINISHED_EVENTS) {
      const oldest = this.finished.values().next().value;
      if (oldest !== undefined) {
        this.finished.delete(oldest);
      }
    }
  }
}

class EventQueueManager {
  queues = new Map;
  subToInstance = new Map;
  register(subId, instanceId, config, deliver, onTimeout, onCancel = () => {}) {
    this.subToInstance.set(subId, instanceId);
    this.queues.set(instanceId, new InstanceQueue(config ?? {}, deliver, onTimeout, onCancel));
  }
  unregister(subId) {
    const instanceId = this.subToInstance.get(subId);
    this.subToInstance.delete(subId);
    if (instanceId) {
      this.queues.delete(instanceId);
    }
  }
  enqueue(instanceId, item) {
    const queue = this.queues.get(instanceId);
    if (!queue) {
      return false;
    }
    queue.enqueue(item);
    return true;
  }
  cancel(instanceId, eventIds) {
    this.queues.get(instanceId)?.cancel(eventIds);
  }
  complete(subId, eventId) {
    const instanceId = this.subToInstance.get(subId);
    if (!instanceId) {
      return;
    }
    this.queues.get(instanceId)?.complete(eventId);
  }
}
function toWidgetEvent(item) {
  return {
    type: item.type,
    source: "scene-manager",
    time: new Date().toISOString(),
    data: item.value,
    eventId: item.eventId
  };
}

// public/scene-manager/ack-batcher.ts
var ACK_BATCH_WINDOW_MS = 250;

class AckBatcher {
  endpoint;
  pending = new Map;
  timer = null;
  windowMs;
  fetchFn;
  constructor(endpoint, options = {}) {
    this.endpoint = endpoint;
    this.windowMs = options.windowMs ?? ACK_BATCH_WINDOW_MS;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
  }
  add(eventId, instanceId) {
    let set = this.pending.get(eventId);
    if (!set) {
      set = new Set;
      this.pending.set(eventId, set);
    }
    set.add(instanceId);
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), this.windowMs);
    }
  }
  flush() {
    this.timer = null;
    const batch = [...this.pending];
    this.pending.clear();
    for (const [eventId, instanceIds] of batch) {
      this.fetchFn(this.endpoint(eventId), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceIds: [...instanceIds] })
      }).catch(() => {});
    }
  }
}

// public/scene-manager/reconnect-coordinator.ts
var ALWAYS_PROBE = {
  shouldProbe: () => true,
  onDisconnected: () => {},
  onConnected: () => {},
  onPeerConnected: () => {},
  requestPeerReload: () => {},
  onPeerReload: () => {},
  stop: () => {}
};
var HEARTBEAT_MS = 2000;
var PEER_TTL_MS = 5500;
var CHANNEL_NAME = "woofx3-scene-manager-reconnect";
function randomPeerId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

class BroadcastReconnectCoordinator {
  channel;
  peerId;
  now;
  heartbeatMs;
  peerTtlMs;
  peersLastSeen = new Map;
  heartbeatTimer = null;
  peerConnectedHandler = null;
  peerReloadHandler = null;
  stopped = false;
  constructor(options) {
    this.channel = options.channel;
    this.peerId = options.peerId ?? randomPeerId();
    this.now = options.now ?? (() => Date.now());
    this.heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
    this.peerTtlMs = options.peerTtlMs ?? PEER_TTL_MS;
    this.channel.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }
  handleMessage(data) {
    const message = data;
    if (!message || typeof message !== "object") {
      return;
    }
    if (message.t === "alive" && typeof message.id === "string") {
      this.peersLastSeen.set(message.id, this.now());
      return;
    }
    if (message.t === "up") {
      this.peerConnectedHandler?.();
      return;
    }
    if (message.t === "reload") {
      this.peerReloadHandler?.();
    }
  }
  shouldProbe() {
    if (this.stopped) {
      return false;
    }
    const cutoff = this.now() - this.peerTtlMs;
    for (const [id, lastSeen] of this.peersLastSeen) {
      if (lastSeen < cutoff) {
        this.peersLastSeen.delete(id);
      }
    }
    for (const id of this.peersLastSeen.keys()) {
      if (id < this.peerId) {
        return false;
      }
    }
    return true;
  }
  onDisconnected() {
    if (this.stopped || this.heartbeatTimer !== null) {
      return;
    }
    this.announceAlive();
    this.heartbeatTimer = setInterval(() => {
      this.announceAlive();
    }, this.heartbeatMs);
  }
  onConnected() {
    this.stopHeartbeat();
    this.post({ t: "up" });
  }
  onPeerConnected(handler) {
    this.peerConnectedHandler = handler;
  }
  requestPeerReload() {
    this.post({ t: "reload" });
  }
  onPeerReload(handler) {
    this.peerReloadHandler = handler;
  }
  stop() {
    this.stopped = true;
    this.stopHeartbeat();
    this.peerConnectedHandler = null;
    this.peerReloadHandler = null;
    this.channel.onmessage = null;
    this.channel.close();
  }
  announceAlive() {
    this.post({ t: "alive", id: this.peerId });
  }
  stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  post(message) {
    try {
      this.channel.postMessage(message);
    } catch {}
  }
}
function adaptBroadcastChannel(channel) {
  let handler = null;
  return {
    postMessage: (message) => channel.postMessage(message),
    close: () => channel.close(),
    get onmessage() {
      return handler;
    },
    set onmessage(next) {
      handler = next;
      channel.onmessage = next ? (event) => next({ data: event.data }) : null;
    }
  };
}
function createReconnectCoordinator() {
  if (typeof BroadcastChannel === "undefined") {
    return ALWAYS_PROBE;
  }
  try {
    return new BroadcastReconnectCoordinator({ channel: adaptBroadcastChannel(new BroadcastChannel(CHANNEL_NAME)) });
  } catch {
    return ALWAYS_PROBE;
  }
}

// public/scene-manager/scene-document.ts
var import_ot_json0 = __toESM(require_lib(), 1);

// public/scene-manager/scene-update.ts
function planSceneUpdate(current, next) {
  const currentById = new Map(current.map((placement) => [placement.id, placement]));
  const nextIds = new Set(next.map((placement) => placement.id));
  const plan = {
    remove: current.filter((placement) => !nextIds.has(placement.id)).map((placement) => placement.id),
    mount: [],
    replace: [],
    place: [],
    order: next.map((placement) => placement.id)
  };
  for (const placement of next) {
    const existing = currentById.get(placement.id);
    if (!existing) {
      plan.mount.push(placement);
    } else if (sameFrame(existing, placement)) {
      plan.place.push(placement);
    } else {
      plan.replace.push(placement);
    }
  }
  return plan;
}
function sameFrame(a, b) {
  return a.widgetCanonicalId === b.widgetCanonicalId && a.moduleId === b.moduleId && a.hostsSurface === b.hostsSurface && a.frameUrl === b.frameUrl && (a.hostsSurface === "" || sameValue(a.settings, b.settings));
}
function settingsUpdate(current, next, reads) {
  const keys = new Set([...Object.keys(current), ...Object.keys(next)]);
  const changed = [...keys].filter((key) => !sameValue(current[key], next[key]));
  if (changed.length === 0) {
    return "none";
  }
  if (reads === null || reads.all || changed.some((key) => reads.keys.has(key))) {
    return "reload";
  }
  return "patch";
}
var THEME_SETTING_ID = "theme";
function themeOf(settings) {
  const value = settings[THEME_SETTING_ID];
  return typeof value === "string" ? value.trim() : "";
}
function sameValue(a, b) {
  if (a === b) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  const aRecord = a;
  const bRecord = b;
  const aKeys = Object.keys(aRecord);
  if (aKeys.length !== Object.keys(bRecord).length) {
    return false;
  }
  return aKeys.every((key) => Object.hasOwn(bRecord, key) && sameValue(aRecord[key], bRecord[key]));
}
function parseSceneConfig(body) {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const scene = body.scene;
  if (typeof scene !== "object" || scene === null) {
    return null;
  }
  const s = scene;
  if (typeof s.id !== "string" || typeof s.layout !== "object" || s.layout === null || !Array.isArray(s.widgets)) {
    return null;
  }
  return {
    id: s.id,
    name: typeof s.name === "string" ? s.name : "",
    layout: s.layout,
    widgets: s.widgets
  };
}

// public/scene-manager/scene-document.ts
var json0 = import_ot_json0.default.type;
function applyOps(doc, ops) {
  return json0.apply(structuredClone(doc), structuredClone([...ops]));
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stackOrder(doc) {
  return Object.keys(doc.widgets).sort((a, b) => {
    const za = doc.widgets[a].z;
    const zb = doc.widgets[b].z;
    return za < zb ? -1 : za > zb ? 1 : a < b ? -1 : a > b ? 1 : 0;
  });
}
function configOfSnapshot(snapshot) {
  const widgets = [];
  for (const id of stackOrder(snapshot.doc)) {
    const placement = snapshot.doc.widgets[id];
    const meta = snapshot.meta[id];
    if (!meta) {
      continue;
    }
    widgets.push({
      id,
      widgetCanonicalId: placement.widget,
      moduleId: meta.moduleId,
      position: { x: placement.x, y: placement.y, width: placement.width, height: placement.height },
      settings: placement.settings,
      hostsSurface: meta.hostsSurface,
      frameUrl: meta.frameUrl,
      linkedResources: meta.linkedResources,
      visible: placement.visible
    });
  }
  return { id: snapshot.sceneId, name: snapshot.name, layout: snapshot.doc.layout, widgets };
}
function mergeMeta(meta, changes) {
  const next = { ...meta };
  for (const [id, value] of Object.entries(changes)) {
    if (value === null) {
      delete next[id];
    } else {
      next[id] = value;
    }
  }
  return next;
}
function parseSnapshot(value) {
  if (!isPlainObject(value)) {
    return null;
  }
  const s = value;
  if (typeof s.sceneId !== "string" || typeof s.seq !== "number" || !isPlainObject(s.doc) || !isPlainObject(s.doc.widgets) || !isPlainObject(s.meta)) {
    return null;
  }
  return value;
}
function parseSceneOpsEvent(value) {
  if (!isPlainObject(value)) {
    return null;
  }
  const e = value;
  if (typeof e.seq !== "number" || !Array.isArray(e.ops) || !isPlainObject(e.meta)) {
    return null;
  }
  return value;
}

// public/scene-manager/event-source.ts
var SESSION_REJECTED_STATUSES = new Set([401, 403]);
function parseSseChunk(rawEvent) {
  const lines = rawEvent.split(`
`);
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const dataLine = lines.find((line) => line.startsWith("data:"));
  if (!dataLine) {
    return null;
  }
  const json = dataLine.slice("data:".length).trim();
  if (!json) {
    return null;
  }
  const eventName = eventLine ? eventLine.slice("event:".length).trim() : "";
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  if (eventName === "hello") {
    return typeof parsed.bootId === "string" && parsed.bootId.length > 0 ? {
      kind: "hello",
      bootId: parsed.bootId,
      seq: typeof parsed.seq === "number" ? parsed.seq : 0,
      draftSeq: typeof parsed.draftSeq === "number" ? parsed.draftSeq : 0
    } : null;
  }
  if (eventName === "scene-ops") {
    const event = parseSceneOpsEvent(parsed);
    return event ? { kind: "scene-ops", event } : null;
  }
  if (eventName === "cancel") {
    const { instanceId, eventIds } = parsed;
    return typeof instanceId === "string" && Array.isArray(eventIds) && eventIds.every((id) => typeof id === "string") ? { kind: "cancel", frame: { instanceId, eventIds } } : null;
  }
  if (eventName === "module-state") {
    return typeof parsed.moduleId === "string" && typeof parsed.key === "string" ? { kind: "module-state", frame: { moduleId: parsed.moduleId, key: parsed.key, value: parsed.value ?? null } } : null;
  }
  if (typeof parsed.eventId === "string" && typeof parsed.instanceId === "string" && typeof parsed.type === "string" && typeof parsed.key === "string") {
    return {
      kind: "delivery",
      frame: {
        eventId: parsed.eventId,
        instanceId: parsed.instanceId,
        type: parsed.type,
        key: parsed.key,
        value: parsed.value
      }
    };
  }
  return null;
}

class SceneEventSource {
  url;
  fetchFn;
  reconnectBaseMs;
  reconnectMaxMs;
  coordinator;
  random;
  sink = null;
  stopped = true;
  everConnected = false;
  reconnectAttempt = 0;
  reconnectTimer = null;
  abortController = null;
  constructor(options) {
    this.url = options.url;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.reconnectBaseMs = options.reconnectBaseMs ?? 500;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 5000;
    this.coordinator = options.coordinator ?? ALWAYS_PROBE;
    this.random = options.random ?? Math.random;
  }
  start(sink) {
    this.sink = sink;
    this.stopped = false;
    this.reconnectAttempt = 0;
    this.coordinator.onPeerConnected(() => {
      this.wakeNow();
    });
    this.connect();
  }
  stop() {
    this.stopped = true;
    this.clearTimer();
    this.abortController?.abort();
    this.abortController = null;
    this.coordinator.stop();
  }
  wakeNow() {
    if (this.stopped || this.reconnectTimer === null) {
      return;
    }
    this.clearTimer();
    this.reconnectAttempt = 0;
    this.connect();
  }
  async connect() {
    if (this.stopped) {
      return;
    }
    const controller = new AbortController;
    this.abortController = controller;
    let response;
    try {
      response = await this.fetchFn(this.url, {
        credentials: "same-origin",
        headers: { Accept: "text/event-stream" },
        signal: controller.signal
      });
    } catch {
      if (!this.stopped) {
        this.onDisconnected();
        this.scheduleReconnect();
      }
      return;
    }
    if (!response.ok || !response.body) {
      if (SESSION_REJECTED_STATUSES.has(response.status) && this.everConnected) {
        this.onDisconnected();
        this.sink?.onSessionExpired?.();
        return;
      }
      this.onDisconnected();
      this.scheduleReconnect();
      return;
    }
    this.everConnected = true;
    this.reconnectAttempt = 0;
    this.coordinator.onConnected();
    this.sink?.onConnectionChange(true);
    const reader = response.body.getReader();
    const decoder = new TextDecoder;
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buffer.indexOf(`

`)) !== -1) {
          const rawEvent = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const parsed = parseSseChunk(rawEvent);
          if (!parsed) {
            continue;
          }
          if (parsed.kind === "hello") {
            this.sink?.onHello?.(parsed.bootId, parsed.seq, parsed.draftSeq);
          } else if (parsed.kind === "module-state") {
            this.sink?.onModuleState?.(parsed.frame);
          } else if (parsed.kind === "scene-ops") {
            this.sink?.onSceneOps?.(parsed.event);
          } else if (parsed.kind === "cancel") {
            this.sink?.onCancel?.(parsed.frame);
          } else {
            this.sink?.onFrame(parsed.frame);
          }
        }
      }
    } catch {}
    if (this.stopped) {
      return;
    }
    this.onDisconnected();
    this.scheduleReconnect();
  }
  onDisconnected() {
    this.coordinator.onDisconnected();
    this.sink?.onConnectionChange(false);
  }
  clearTimer() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
  nextDelayMs() {
    const capped = Math.min(this.reconnectBaseMs * 2 ** this.reconnectAttempt, this.reconnectMaxMs);
    return capped / 2 + this.random() * (capped / 2);
  }
  scheduleReconnect() {
    if (this.stopped) {
      return;
    }
    const delay = this.nextDelayMs();
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.coordinator.shouldProbe()) {
        this.scheduleReconnect();
        return;
      }
      this.connect();
    }, delay);
  }
}

// public/scene-manager/module-state.ts
class ModuleStateCache {
  fetchValue;
  entries = new Map;
  constructor(fetchValue) {
    this.fetchValue = fetchValue;
  }
  peek(moduleId, key) {
    const entry = this.entries.get(entryKey(moduleId, key));
    return entry?.known ? entry.value : null;
  }
  watch(moduleId, key, target) {
    const entry = this.entry(moduleId, key);
    entry.targets.set(target, (entry.targets.get(target) ?? 0) + 1);
    this.load(entry);
  }
  unwatch(moduleId, key, target) {
    const entry = this.entries.get(entryKey(moduleId, key));
    const count = entry?.targets.get(target);
    if (!entry || count === undefined) {
      return;
    }
    if (count > 1) {
      entry.targets.set(target, count - 1);
    } else {
      entry.targets.delete(target);
    }
  }
  unwatchAll(target) {
    for (const entry of this.entries.values()) {
      entry.targets.delete(target);
    }
  }
  apply(moduleId, key, value) {
    const entry = this.entries.get(entryKey(moduleId, key));
    if (!entry) {
      return;
    }
    entry.generation += 1;
    this.settle(entry, value);
  }
  refresh() {
    for (const entry of this.entries.values()) {
      if (entry.targets.size > 0) {
        this.load(entry);
      }
    }
  }
  entry(moduleId, key) {
    const id = entryKey(moduleId, key);
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { moduleId, key, known: false, value: null, generation: 0, loading: false, targets: new Map };
      this.entries.set(id, entry);
    }
    return entry;
  }
  async load(entry) {
    if (entry.loading) {
      return;
    }
    const via = entry.targets.keys().next().value;
    if (via === undefined) {
      return;
    }
    entry.loading = true;
    const generation = entry.generation;
    let value;
    try {
      value = await this.fetchValue(via.instanceId, entry.key);
    } catch {
      if (entry.known && entry.generation === generation) {
        this.settle(entry, entry.value);
      }
      return;
    } finally {
      entry.loading = false;
    }
    if (entry.generation !== generation) {
      return;
    }
    this.settle(entry, value);
  }
  settle(entry, value) {
    entry.known = true;
    entry.value = value;
    for (const target of entry.targets.keys()) {
      target.sendStorageValue(entry.key, value);
    }
  }
}
function entryKey(moduleId, key) {
  return `${moduleId}\x00${key}`;
}

// public/scene-manager/connection-status.ts
class ConnectionStatus {
  render;
  unhealthy = new Set(["stream"]);
  lastRendered = null;
  constructor(render) {
    this.render = render;
  }
  set(input, healthy) {
    if (healthy) {
      this.unhealthy.delete(input);
    } else {
      this.unhealthy.add(input);
    }
    const connected = this.unhealthy.size === 0;
    if (connected === this.lastRendered) {
      return;
    }
    this.lastRendered = connected;
    this.render(connected);
  }
  get connected() {
    return this.unhealthy.size === 0;
  }
}

// public/scene-manager/preview-layout.ts
var PREVIEW_LAYOUT_MESSAGE = "woofx3.scene-preview.layout";
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function parseWidget(raw) {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const w = raw;
  if (typeof w.id !== "string" || w.id.length === 0) {
    return null;
  }
  if (!isFiniteNumber(w.x) || !isFiniteNumber(w.y) || !isFiniteNumber(w.width) || !isFiniteNumber(w.height)) {
    return null;
  }
  return { id: w.id, x: w.x, y: w.y, width: w.width, height: w.height };
}
function parsePreviewLayout(data) {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const message = data;
  if (message.type !== PREVIEW_LAYOUT_MESSAGE || !Array.isArray(message.widgets)) {
    return null;
  }
  const widgets = [];
  for (const raw of message.widgets) {
    const widget = parseWidget(raw);
    if (widget) {
      widgets.push(widget);
    }
  }
  return widgets;
}
function parsePreviewPlacements(data) {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const message = data;
  if (message.type !== PREVIEW_LAYOUT_MESSAGE || !Array.isArray(message.placements)) {
    return null;
  }
  return message.placements;
}
function draftFrameKey(placements, drawnByPage = () => false) {
  return JSON.stringify(placements.map((raw) => {
    const placement = typeof raw === "object" && raw !== null ? raw : {};
    const drawn = typeof placement.id === "string" && drawnByPage(placement.id);
    return [placement.id, placement.widgetCanonicalId, drawn ? placement.settings : themeOf(settingsOf(placement))];
  }));
}
function settingsOf(placement) {
  const settings = placement.settings;
  return typeof settings === "object" && settings !== null && !Array.isArray(settings) ? settings : {};
}
function applyPreviewLayout(elements, layout) {
  const byId = new Map(layout.map((widget) => [widget.id, widget]));
  for (const [id, element] of elements) {
    const widget = byId.get(id);
    if (!widget) {
      element.style.display = "none";
      continue;
    }
    element.style.display = "";
    element.style.left = `${widget.x}px`;
    element.style.top = `${widget.y}px`;
    element.style.width = `${widget.width}px`;
    element.style.height = `${widget.height}px`;
  }
}

// public/scene-manager/scene-background.ts
function sceneBackground(layout) {
  const value = layout.backgroundColor;
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
function applySceneBackground(element, layout) {
  element.style.backgroundColor = sceneBackground(layout) ?? "";
}

// public/scene-manager/index.ts
var REFRESH_INTERVAL_MS = 50000;
var DRAFT_SETTLE_MS = 400;
var SWAP_TIMEOUT_MS = 2000;
function generateNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function frameSrc(instance, nonce) {
  const boot = encodePlacementBoot({
    nonce,
    instanceId: instance.id,
    settings: instance.settings,
    linkedResources: instance.linkedResources ?? {}
  });
  return `${instance.frameUrl}#${boot}`;
}
function showIf(element, visible) {
  if (element) {
    element.style.visibility = visible === false ? "hidden" : "";
  }
}
function asRecord(value) {
  return typeof value === "object" && value !== null ? value : {};
}
function placeAt(element, position) {
  element.style.left = `${position.x}px`;
  element.style.top = `${position.y}px`;
  element.style.width = `${position.width}px`;
  element.style.height = `${position.height}px`;
}
function renderConnected(connected) {
  const banner = document.getElementById("disconnected-banner");
  banner?.classList.toggle("visible", !connected);
  try {
    document.dispatchEvent(new CustomEvent("datastar-signal-patch", { detail: { connected } }));
  } catch {}
}
function main() {
  const sceneData = window.__WOOFX3_SCENE__?.scene;
  const container = document.getElementById("widgets");
  if (!sceneData || !container) {
    return;
  }
  applySceneBackground(document.body, sceneData.layout);
  const sceneId = sceneData.id;
  let sceneDoc = parseSnapshot(window.__WOOFX3_SCENE__?.document);
  const sceneBase = `/scene/${encodeURIComponent(sceneId)}`;
  const view = new URLSearchParams(location.search).get("view") === "draft" ? "draft" : "published";
  const bridges = new Set;
  const widgetElements = new Map;
  const queueManager = new EventQueueManager;
  const deliveredBatcher = new AckBatcher((eventId) => `${sceneBase}/events/${encodeURIComponent(eventId)}/delivered`);
  const completedBatcher = new AckBatcher((eventId) => `${sceneBase}/events/${encodeURIComponent(eventId)}/completed`);
  const moduleState = new ModuleStateCache(async (instanceId, key) => {
    const url = `${sceneBase}/widget/${encodeURIComponent(instanceId)}/storage?key=${encodeURIComponent(key)}`;
    const resp = await fetch(url, { credentials: "same-origin" });
    if (!resp.ok) {
      throw new Error(`module state ${key}: ${resp.status}`);
    }
    const body = await resp.json();
    return body.value ?? null;
  });
  function postStatus(instanceId, report) {
    fetch(`${sceneBase}/widget/${encodeURIComponent(instanceId)}/status`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        moduleId: report.moduleId,
        widgetCanonicalId: report.widgetCanonicalId,
        key: report.key,
        value: report.value,
        ts: report.ts
      })
    }).catch(() => {});
  }
  function postAlertAck(kind, eventId, instanceId) {
    fetch(`${sceneBase}/events/${encodeURIComponent(eventId)}/${kind}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceIds: [instanceId] })
    }).catch(() => {});
  }
  const mounted = new Map;
  const mountAlertWidget = (instance) => {
    const element = document.createElement("div");
    element.className = "alert-widget";
    placeAt(element, instance.position);
    container.appendChild(element);
    widgetElements.set(instance.id, element);
    const subId = `alert:${instance.id}`;
    const alertWidget = new AlertWidget({
      element,
      sceneBase,
      bridges,
      generateNonce,
      postStatus,
      onFinished: (eventId) => {
        queueManager.complete(subId, eventId);
        postAlertAck("completed", eventId, instance.id);
      }
    });
    queueManager.register(subId, instance.id, { maxInFlight: 1 }, (item) => {
      postAlertAck("started", item.eventId, instance.id);
      return alertWidget.play(item);
    }, () => {}, (eventId) => alertWidget.stop(eventId));
    return () => {
      alertWidget.dispose();
      queueManager.unregister(subId);
      widgetElements.delete(instance.id);
      element.remove();
    };
  };
  const mountFramedWidget = (instance, hidden = false, onRendered) => {
    const iframe = document.createElement("iframe");
    iframe.className = "widget-frame";
    placeAt(iframe, instance.position);
    if (hidden) {
      iframe.style.opacity = "0";
    }
    iframe.setAttribute("sandbox", "allow-scripts");
    const nonce = generateNonce();
    let currentSubId = null;
    const callbacks = {
      onStorageGet: (_moduleId, key) => moduleState.peek(instance.moduleId, key),
      onStorageSubscribe: (_moduleId, key) => moduleState.watch(instance.moduleId, key, storageTarget),
      onStorageUnsubscribe: (_moduleId, key) => moduleState.unwatch(instance.moduleId, key, storageTarget),
      onStatusReport: (report) => postStatus(instance.id, report),
      onEventsSubscribe: (subId, queue) => {
        currentSubId = subId;
        queueManager.register(subId, instance.id, queue, (item) => bridge.sendEvent(subId, toWidgetEvent(item)), () => {});
      },
      onEventsUnsubscribe: (subId) => {
        queueManager.unregister(subId);
        if (currentSubId === subId) {
          currentSubId = null;
        }
      },
      onEventComplete: (subId, eventId) => {
        queueManager.complete(subId, eventId);
        completedBatcher.add(eventId, instance.id);
      },
      onDispose: () => {
        if (currentSubId) {
          queueManager.unregister(currentSubId);
          currentSubId = null;
        }
      },
      onRendered
    };
    const bridge = new WidgetBridge(instance.id, nonce, callbacks);
    const storageTarget = {
      instanceId: instance.id,
      sendStorageValue: (key, value) => bridge.sendStorageValue(key, value)
    };
    iframe.addEventListener("load", createFrameLoadHandler(bridge));
    iframe.src = frameSrc(instance, nonce);
    bridges.add(bridge);
    container.appendChild(iframe);
    if (!hidden) {
      widgetElements.set(instance.id, iframe);
    }
    bridge.attach(iframe);
    const unmount = () => {
      bridge.dispose();
      bridge.detach();
      bridges.delete(bridge);
      moduleState.unwatchAll(storageTarget);
      if (widgetElements.get(instance.id) === iframe) {
        widgetElements.delete(instance.id);
      }
      iframe.remove();
    };
    return { element: iframe, bridge, unmount };
  };
  function mount(instance) {
    if (instance.hostsSurface === "alert") {
      mounted.set(instance.id, { config: instance, unmount: mountAlertWidget(instance), bridge: null, swap: null });
    } else {
      const frame = mountFramedWidget(instance);
      mounted.set(instance.id, { config: instance, unmount: frame.unmount, bridge: frame.bridge, swap: null });
    }
    showIf(widgetElements.get(instance.id), instance.visible);
  }
  function unmountPlacement(id) {
    const entry = mounted.get(id);
    entry?.swap?.cancel();
    entry?.unmount();
    mounted.delete(id);
  }
  function swapFrame(next) {
    const entry = mounted.get(next.id);
    if (!entry || next.hostsSurface !== "" || entry.config.hostsSurface !== "") {
      unmountPlacement(next.id);
      mount(next);
      return;
    }
    entry.swap?.cancel();
    let settled = false;
    let timer = null;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
      const old = widgetElements.get(next.id);
      fresh.element.style.zIndex = old?.style.zIndex ?? "";
      fresh.element.style.display = old?.style.display ?? "";
      fresh.element.style.opacity = "";
      showIf(fresh.element, next.visible);
      entry.unmount();
      widgetElements.set(next.id, fresh.element);
      mounted.set(next.id, { config: next, unmount: fresh.unmount, bridge: fresh.bridge, swap: null });
      if (previewLayout) {
        applyPreviewLayout(widgetElements, previewLayout);
      }
    };
    const fresh = mountFramedWidget(next, true, finish);
    timer = setTimeout(finish, SWAP_TIMEOUT_MS);
    entry.swap = {
      cancel: () => {
        if (!settled) {
          settled = true;
          if (timer !== null) {
            clearTimeout(timer);
          }
          fresh.unmount();
        }
      }
    };
  }
  function updateSettings(id, settings) {
    const entry = mounted.get(id);
    if (!entry) {
      return;
    }
    const reads = entry.swap || !entry.bridge ? null : entry.bridge.settingsReads();
    const decision = settingsUpdate(entry.config.settings, settings, reads);
    if (decision === "none") {
      return;
    }
    if (decision === "patch" && entry.bridge) {
      entry.bridge.sendSettings(settings);
      entry.config = { ...entry.config, settings };
      return;
    }
    swapFrame({ ...entry.config, settings });
  }
  function stack(order) {
    order.forEach((id, index) => {
      const element = widgetElements.get(id);
      if (element) {
        element.style.zIndex = String(index);
      }
    });
  }
  for (const instance of sceneData.widgets) {
    mount(instance);
  }
  stack(sceneData.widgets.map((instance) => instance.id));
  let previewLayout = null;
  let draftPlacements = null;
  let draftKey = "";
  let draftTimer = null;
  window.addEventListener("message", (event) => {
    for (const bridge of bridges) {
      bridge.handleMessage(event);
    }
  });
  if (window.parent !== window) {
    window.addEventListener("message", (event) => {
      if (event.source !== window.parent) {
        return;
      }
      const layout = parsePreviewLayout(event.data);
      if (layout) {
        previewLayout = layout;
        applyPreviewLayout(widgetElements, layout);
      }
      const placements = parsePreviewPlacements(event.data);
      if (placements) {
        draftPlacements = placements;
        for (const raw of placements) {
          const placement = asRecord(raw);
          const entry = typeof placement.id === "string" ? mounted.get(placement.id) : undefined;
          const settings = settingsOf(placement);
          if (entry && entry.config.hostsSurface === "" && themeOf(entry.config.settings) === themeOf(settings)) {
            updateSettings(entry.config.id, settings);
          }
        }
        const key = draftFrameKey(placements, (id) => mounted.get(id)?.config.hostsSurface === "alert");
        if (key !== draftKey) {
          draftKey = key;
          if (draftTimer !== null) {
            clearTimeout(draftTimer);
          }
          draftTimer = setTimeout(() => {
            draftTimer = null;
            updateScene();
          }, DRAFT_SETTLE_MS);
        }
      }
    });
  }
  function applySceneConfig(next, fromDraft) {
    if (fromDraft && draftPlacements) {
      const latest = new Map(draftPlacements.map((raw) => [asRecord(raw).id, settingsOf(asRecord(raw))]));
      for (const instance of next.widgets) {
        const settings = latest.get(instance.id);
        if (settings && instance.hostsSurface === "" && themeOf(settings) === themeOf(instance.settings)) {
          instance.settings = settings;
        }
      }
    }
    const plan = planSceneUpdate([...mounted.values()].map((entry) => entry.config), next.widgets);
    for (const id of plan.remove) {
      unmountPlacement(id);
    }
    for (const instance of plan.place) {
      const entry = mounted.get(instance.id);
      const element = widgetElements.get(instance.id);
      if (entry && element) {
        entry.config = { ...instance, settings: entry.config.settings };
        placeAt(element, instance.position);
        showIf(element, instance.visible);
        updateSettings(instance.id, instance.settings);
      }
    }
    for (const instance of plan.replace) {
      swapFrame(instance);
    }
    for (const instance of plan.mount) {
      mount(instance);
    }
    stack(plan.order);
    applySceneBackground(document.body, next.layout);
    if (previewLayout) {
      applyPreviewLayout(widgetElements, previewLayout);
    }
  }
  function applySceneOps(event) {
    if ((event.version ?? "published") !== view) {
      return;
    }
    if (sceneDoc && event.seq <= sceneDoc.seq) {
      return;
    }
    if (!sceneDoc || event.seq !== sceneDoc.seq + 1) {
      updateScene();
      return;
    }
    try {
      sceneDoc = {
        ...sceneDoc,
        seq: event.seq,
        doc: applyOps(sceneDoc.doc, event.ops),
        meta: mergeMeta(sceneDoc.meta, event.meta)
      };
    } catch (err) {
      console.warn("[scene-manager] scene ops did not apply; resyncing", err);
      updateScene();
      return;
    }
    if (draftPlacements) {
      updateScene();
      return;
    }
    applySceneConfig(configOfSnapshot(sceneDoc), false);
  }
  async function fetchTarget() {
    const draft = draftPlacements;
    let resp;
    try {
      resp = draft ? await fetch(`${sceneBase}/draft-config`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widgets: draft })
      }) : await fetch(`${sceneBase}/config${view === "draft" ? "?view=draft" : ""}`, {
        credentials: "same-origin",
        cache: "no-store"
      });
    } catch {
      return draft ? { kind: "keep" } : { kind: "reload" };
    }
    const body = resp.ok ? await resp.json().catch(() => null) : null;
    const config = parseSceneConfig(body);
    if (config && config.id === sceneId) {
      const snapshot = draft ? null : parseSnapshot(asRecord(body).document);
      if (snapshot) {
        sceneDoc = snapshot;
      }
      return { kind: "apply", config, fromDraft: draft !== null };
    }
    if (draft && resp.status !== 401) {
      console.warn("[scene-manager] draft preview refused; showing the last one", { status: resp.status });
      return { kind: "keep" };
    }
    return { kind: "reload" };
  }
  let updating = false;
  let updateRequested = false;
  async function updateScene() {
    updateRequested = true;
    if (updating) {
      return;
    }
    updating = true;
    try {
      while (updateRequested) {
        updateRequested = false;
        const target = await fetchTarget();
        if (target.kind === "reload") {
          location.reload();
          return;
        }
        if (target.kind === "apply") {
          applySceneConfig(target.config, target.fromDraft);
        }
      }
    } finally {
      updating = false;
    }
  }
  const status = new ConnectionStatus(renderConnected);
  let serverBootId = null;
  const coordinator = createReconnectCoordinator();
  function reloadOverlay() {
    coordinator.requestPeerReload();
    location.reload();
  }
  coordinator.onPeerReload(() => {
    location.reload();
  });
  const eventSource = new SceneEventSource({
    url: new URL(`${sceneBase}/events`, location.href).toString(),
    coordinator
  });
  eventSource.start({
    onFrame: (frame) => {
      deliveredBatcher.add(frame.eventId, frame.instanceId);
      queueManager.enqueue(frame.instanceId, {
        eventId: frame.eventId,
        type: frame.type,
        key: frame.key,
        value: frame.value
      });
    },
    onModuleState: (frame) => moduleState.apply(frame.moduleId, frame.key, frame.value),
    onCancel: (frame) => queueManager.cancel(frame.instanceId, frame.eventIds),
    onConnectionChange: (connected) => status.set("stream", connected),
    onSceneOps: applySceneOps,
    onHello: (bootId, publishedSeq, draftSeq) => {
      const seq = view === "draft" ? draftSeq : publishedSeq;
      if (serverBootId !== null && serverBootId !== bootId) {
        reloadOverlay();
        return;
      }
      if (serverBootId !== null) {
        moduleState.refresh();
      }
      serverBootId = bootId;
      if (!sceneDoc || seq !== sceneDoc.seq) {
        updateScene();
      }
    },
    onSessionExpired: () => {
      reloadOverlay();
    }
  });
  setInterval(() => {
    fetch(`${sceneBase}/session/refresh`, { method: "POST", credentials: "same-origin" }).then((resp) => {
      if (!resp.ok) {
        throw new Error(`refresh failed: ${resp.status}`);
      }
      status.set("session", true);
    }).catch(() => {
      status.set("session", false);
    });
  }, REFRESH_INTERVAL_MS);
}
main();
