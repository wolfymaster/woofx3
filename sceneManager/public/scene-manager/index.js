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

// ../shared/clients/typescript/api/node_modules/ot-json0/lib/bootstrapTransform.js
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

// ../shared/clients/typescript/api/node_modules/ot-json0/lib/text0.js
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

// ../shared/clients/typescript/api/node_modules/ot-json0/lib/json0.js
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

// ../shared/clients/typescript/api/node_modules/ot-json0/lib/index.js
var require_lib = __commonJS((exports, module) => {
  module.exports = {
    type: require_json0()
  };
});

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
// ../shared/clients/typescript/module-sdk/dist/widget-fonts.js
var GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
  "inherit",
  "initial",
  "unset",
  "revert"
]);
// ../shared/clients/typescript/scene/model/composition.ts
function assert(condition, message) {
  if (!condition) {
    throw new Error(`invariant violated: ${message}`);
  }
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
function isCompositionShape(value) {
  return isPlainObject(value) && isPlainObject(value.layout) && isPlainObject(value.widgets) && isPlainObject(value.behaviors);
}
function normalizeComposition(value) {
  if (!isPlainObject(value) || !isPlainObject(value.layout) || !isPlainObject(value.widgets)) {
    return null;
  }
  if (value.behaviors === undefined) {
    return { ...value, behaviors: {} };
  }
  if (!isPlainObject(value.behaviors)) {
    return null;
  }
  return value;
}

// ../shared/clients/typescript/scene/model/types.ts
var CANVAS_TARGET = "canvas";
var ANCHOR_KINDS = ["start", "end", "enter", "exit", "complete"];
var EASINGS = ["linear", "ease", "ease-in", "ease-out", "ease-in-out"];
var PROFILES = {
  scene: { id: "scene", surface: "scene", bounded: false, anchors: ["enter", "exit", "complete"] },
  alert: { id: "alert", surface: "alert", bounded: true, anchors: ["start", "end", "enter", "exit", "complete"] }
};

// ../shared/clients/typescript/scene/model/entity-types.ts
var ENTRY_ID_MAX_LENGTH = 128;
var KIND_ID = /^[a-z][a-z0-9-]{0,31}$/;
var HOST_TRANSITION_KINDS = ["fade", "slide", "zoom", "bounce", "spin", "pop", "blur"];
var TRANSITION_PHASES = ["in", "out"];
var TRANSITION_DIRECTIONS = ["up", "down", "left", "right"];
var MIN_TRANSITION_MS = 50;
var MAX_TRANSITION_MS = 1e4;
var DEFAULT_TRANSITION_MS = 400;
var HOST_EFFECT_KINDS = ["shake", "pulse", "float", "glow", "flash", "blur"];
var NO_DECLARED_KINDS = Object.freeze({
  transitions: Object.freeze([]),
  effects: Object.freeze([])
});
function declaresKind(declared, type, kind) {
  if (type === "transition") {
    return declared.transitions.includes(kind);
  }
  if (type === "effect") {
    return declared.effects.includes(kind);
  }
  return false;
}
var ACTIVITY_KINDS = ["window"];
var MAX_TIMING_MS = 5 * 60 * 1000;
var MAX_WIDGET_ID_LENGTH = 256;
var PLACEMENT_NAME_MAX_LENGTH = 256;
var MAX_KEY_LENGTH = 64;
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function isIntegerIn(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}
function isNumberIn(value, min, max) {
  return isFiniteNumber(value) && value >= min && value <= max;
}
function isEntryId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= ENTRY_ID_MAX_LENGTH;
}
function isSortKey(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_KEY_LENGTH;
}
function isOneOf(options, value) {
  return options.includes(value);
}
var ID_SCHEMA = { type: "string", minLength: 1, maxLength: ENTRY_ID_MAX_LENGTH };
var SORT_KEY_SCHEMA = { type: "string", minLength: 1, maxLength: MAX_KEY_LENGTH };
var FINITE_NUMBER_SCHEMA = { type: "number" };
var OBJECT_SCHEMA = { type: "object" };
function field(grain, valid, schema) {
  return { grain, valid, schema };
}
var PLACEMENT_FIELDS = {
  widget: field("value", (v) => typeof v === "string" && v.length > 0 && v.length <= MAX_WIDGET_ID_LENGTH, {
    type: "string",
    minLength: 1,
    maxLength: MAX_WIDGET_ID_LENGTH
  }),
  x: field("value", isFiniteNumber, FINITE_NUMBER_SCHEMA),
  y: field("value", isFiniteNumber, FINITE_NUMBER_SCHEMA),
  width: field("value", (v) => isFiniteNumber(v) && v >= 0, { type: "number", minimum: 0 }),
  height: field("value", (v) => isFiniteNumber(v) && v >= 0, { type: "number", minimum: 0 }),
  visible: field("value", (v) => typeof v === "boolean", { type: "boolean" }),
  z: field("value", isSortKey, SORT_KEY_SCHEMA),
  settings: field("freeform", isPlainObject, OBJECT_SCHEMA),
  name: field("text", (v) => typeof v === "string" && v.length <= PLACEMENT_NAME_MAX_LENGTH, {
    type: "string",
    maxLength: PLACEMENT_NAME_MAX_LENGTH
  }),
  rotation: field("value", isFiniteNumber, FINITE_NUMBER_SCHEMA),
  opacity: field("value", (v) => isNumberIn(v, 0, 1), { type: "number", minimum: 0, maximum: 1 }),
  locked: field("value", (v) => typeof v === "boolean", { type: "boolean" }),
  extra: field("freeform", isPlainObject, OBJECT_SCHEMA)
};
function isDuration(value) {
  return value === "until-exit" || isIntegerIn(value, 0, MAX_TIMING_MS);
}
var TIMING_SUBFIELDS = {
  anchor: {
    optional: false,
    valid: (v) => isOneOf(ANCHOR_KINDS, v),
    schema: { enum: [...ANCHOR_KINDS] }
  },
  node: { optional: true, valid: isEntryId, schema: ID_SCHEMA },
  offsetMs: {
    optional: false,
    valid: (v) => isIntegerIn(v, -MAX_TIMING_MS, MAX_TIMING_MS),
    schema: { type: "integer", minimum: -MAX_TIMING_MS, maximum: MAX_TIMING_MS }
  },
  durationMs: {
    optional: false,
    valid: isDuration,
    schema: {
      anyOf: [{ const: "until-exit" }, { type: "integer", minimum: 0, maximum: MAX_TIMING_MS }]
    }
  },
  easing: { optional: false, valid: (v) => isOneOf(EASINGS, v), schema: { enum: [...EASINGS] } }
};
function isTiming(value, mode) {
  if (!isPlainObject(value)) {
    return false;
  }
  for (const [name, sub] of Object.entries(TIMING_SUBFIELDS)) {
    const present = Object.hasOwn(value, name);
    if (!present && !sub.optional) {
      return false;
    }
    if (present && !sub.valid(value[name])) {
      return false;
    }
  }
  return mode === "tolerant" || Object.keys(value).every((key) => Object.hasOwn(TIMING_SUBFIELDS, key));
}
var BEHAVIOR_FIELDS = {
  type: field("fixed", (v) => typeof v === "string" && KIND_ID.test(v), { type: "string", pattern: KIND_ID.source }),
  kind: field("value", (v) => typeof v === "string" && KIND_ID.test(v), { type: "string", pattern: KIND_ID.source }),
  target: field("value", isEntryId, ID_SCHEMA),
  order: field("value", isSortKey, SORT_KEY_SCHEMA),
  timing: {
    grain: "struct",
    valid: isTiming,
    subfields: TIMING_SUBFIELDS,
    schema: {
      type: "object",
      required: Object.entries(TIMING_SUBFIELDS).filter(([, sub]) => !sub.optional).map(([name]) => name),
      properties: Object.fromEntries(Object.entries(TIMING_SUBFIELDS).map(([name, sub]) => [name, sub.schema]))
    }
  },
  params: field("keyed", isPlainObject, OBJECT_SCHEMA)
};
var WIDGETS_COLLECTION = {
  name: "widgets",
  noun: "placement",
  fields: PLACEMENT_FIELDS,
  typeOf: () => WIDGET_TYPE_NAME
};
var BEHAVIORS_COLLECTION = {
  name: "behaviors",
  noun: "behavior",
  fields: BEHAVIOR_FIELDS,
  typeOf: (entry) => typeof entry.type === "string" ? entry.type : null
};
var BUILTIN_COLLECTIONS = [WIDGETS_COLLECTION, BEHAVIORS_COLLECTION];
var WIDGET_TYPE_NAME = "widget";
var PLACEMENT_DEFAULTS = {
  x: 0,
  y: 0,
  visible: true,
  settings: {},
  name: "",
  rotation: 0,
  opacity: 1,
  locked: false,
  extra: {}
};
var BUILTIN_WIDGET_TRAITS = {
  "woofx3:widget:text": { heightFollowsText: true },
  "woofx3:widget:image": { keepsAspect: true },
  "woofx3:widget:video": { keepsAspect: true },
  "woofx3:widget:lottie": { keepsAspect: true }
};
var LEGACY_TRANSITION_FIELDS = {
  transitionIn: "in",
  transitionOut: "out"
};
var WIDGET_TYPE = {
  collection: "widgets",
  name: WIDGET_TYPE_NAME,
  invalid: () => null,
  withDefaults(seed) {
    return {
      ...structuredClone(PLACEMENT_DEFAULTS),
      ...seed
    };
  },
  migrate(entry, id) {
    if (!isPlainObject(entry.extra)) {
      return { entry };
    }
    const extra = { ...entry.extra };
    const behaviors = {};
    for (const [key, phase] of Object.entries(LEGACY_TRANSITION_FIELDS)) {
      const behavior = behaviorOfLegacyTransition(extra[key], id, phase);
      if (behavior !== null) {
        behaviors[legacyTransitionId(id, phase)] = behavior;
        delete extra[key];
      }
    }
    if (Object.keys(behaviors).length === 0) {
      return { entry };
    }
    return { entry: { ...entry, extra }, behaviors };
  },
  schema: () => ({})
};
function legacyTransitionId(placementId, phase) {
  return `${placementId}:transition-${phase}`;
}
function behaviorOfLegacyTransition(value, target, phase) {
  if (!isPlainObject(value)) {
    return null;
  }
  const { type, durationMs, easing, direction } = value;
  const known = Object.keys(value).every((key) => ["type", "durationMs", "easing", "direction"].includes(key));
  if (!known || typeof type !== "string" || !KIND_ID.test(type) || !isIntegerIn(durationMs, MIN_TRANSITION_MS, MAX_TRANSITION_MS) || !(easing === undefined || isOneOf(EASINGS, easing)) || !(direction === undefined || type === "slide" && isOneOf(TRANSITION_DIRECTIONS, direction))) {
    return null;
  }
  return {
    type: TRANSITION_TYPE_NAME,
    kind: type,
    target,
    order: "a0",
    timing: {
      anchor: phase === "in" ? "enter" : "exit",
      offsetMs: 0,
      durationMs,
      easing: easing ?? defaultTransitionEasing(phase)
    },
    params: direction === undefined ? { phase } : { phase, direction }
  };
}
function behaviorType(definition) {
  const executorOf = (kind) => {
    if (definition.hostKinds.includes(kind)) {
      return "host";
    }
    return definition.widgetKinds && KIND_ID.test(kind) ? "widget" : null;
  };
  return {
    collection: "behaviors",
    name: definition.name,
    executorOf,
    invalid(entry, mode) {
      const behavior = entry;
      const executor = executorOf(behavior.kind);
      if (executor === null) {
        return `a ${definition.name} has no kind ${behavior.kind}`;
      }
      if (behavior.target === CANVAS_TARGET && !definition.canvasTarget) {
        return `a ${definition.name} targets a widget, not the canvas`;
      }
      const timing = definition.invalidTiming(behavior.timing);
      if (timing !== null) {
        return timing;
      }
      return invalidParams(definition, behavior, executor, mode);
    },
    withDefaults: (seed) => definition.withDefaults(seed),
    schema: (mode) => behaviorTypeSchema(definition, mode)
  };
}
function invalidParams(definition, behavior, executor, mode) {
  const hostParams = executor === "host" ? definition.hostParams[behavior.kind] ?? {} : {};
  for (const [name, spec] of Object.entries(definition.commonParams)) {
    if (!Object.hasOwn(behavior.params, name)) {
      if (spec.required) {
        return `a ${definition.name} needs params.${name}`;
      }
      continue;
    }
    if (!spec.valid(behavior.params[name])) {
      return `invalid ${definition.name} params.${name}`;
    }
  }
  for (const [name, value] of Object.entries(behavior.params)) {
    if (Object.hasOwn(definition.commonParams, name)) {
      continue;
    }
    if (Object.hasOwn(hostParams, name)) {
      if (!hostParams[name].valid(value)) {
        return `invalid ${definition.name} params.${name}`;
      }
      continue;
    }
    if (executor === "host" && mode === "strict") {
      return `a ${behavior.kind} ${definition.name} has no param ${name}`;
    }
  }
  return null;
}
function behaviorTypeSchema(definition, mode) {
  const common = Object.fromEntries(Object.entries(definition.commonParams).map(([name, spec]) => [name, spec.schema]));
  const required = Object.entries(definition.commonParams).filter(([, spec]) => spec.required).map(([name]) => name);
  const hostBranches = definition.hostKinds.map((kind) => {
    const params = definition.hostParams[kind] ?? {};
    return {
      properties: {
        kind: { const: kind },
        params: {
          type: "object",
          required,
          properties: {
            ...common,
            ...Object.fromEntries(Object.entries(params).map(([name, spec]) => [name, spec.schema]))
          },
          additionalProperties: mode === "tolerant"
        }
      }
    };
  });
  const kindBranches = [...hostBranches];
  if (definition.widgetKinds) {
    kindBranches.push({
      properties: {
        kind: { type: "string", pattern: KIND_ID.source, not: { enum: [...definition.hostKinds] } },
        params: { type: "object", required, properties: common }
      }
    });
  }
  const schema = {
    properties: { type: { const: definition.name }, timing: definition.timingSchema },
    oneOf: kindBranches
  };
  if (!definition.canvasTarget) {
    schema.properties = {
      ...schema.properties,
      target: { not: { const: CANVAS_TARGET } }
    };
  }
  return schema;
}
function defaultTransitionEasing(phase) {
  return phase === "in" ? "ease-out" : "ease-in";
}
function timingWithDefaults(seed, defaults) {
  return { ...defaults, ...seed ?? {} };
}
function behaviorBase(seed, name, kind) {
  assert(seed.target !== undefined, `a new ${name} names its target`);
  return {
    type: name,
    kind: seed.kind ?? kind,
    target: seed.target,
    order: seed.order ?? "a0",
    params: { ...seed.params ?? {} }
  };
}
var TRANSITION_TYPE_NAME = "transition";
var EFFECT_TYPE_NAME = "effect";
var ACTIVITY_TYPE_NAME = "activity";
var TRANSITION_TYPE = behaviorType({
  name: TRANSITION_TYPE_NAME,
  hostKinds: HOST_TRANSITION_KINDS,
  widgetKinds: true,
  commonParams: {
    phase: {
      required: true,
      valid: (v) => isOneOf(TRANSITION_PHASES, v),
      schema: { enum: [...TRANSITION_PHASES] }
    }
  },
  hostParams: {
    slide: {
      direction: { valid: (v) => isOneOf(TRANSITION_DIRECTIONS, v), schema: { enum: [...TRANSITION_DIRECTIONS] } }
    }
  },
  canvasTarget: true,
  invalidTiming(timing) {
    if (!isIntegerIn(timing.durationMs, MIN_TRANSITION_MS, MAX_TRANSITION_MS)) {
      return `a transition lasts from ${MIN_TRANSITION_MS} to ${MAX_TRANSITION_MS} ms`;
    }
    return null;
  },
  timingSchema: {
    properties: { durationMs: { type: "integer", minimum: MIN_TRANSITION_MS, maximum: MAX_TRANSITION_MS } }
  },
  withDefaults(seed) {
    const base = behaviorBase(seed, TRANSITION_TYPE_NAME, "fade");
    const phase = isOneOf(TRANSITION_PHASES, base.params.phase) ? base.params.phase : "in";
    const params = { ...base.params, phase };
    if (base.kind === "slide" && params.direction === undefined) {
      params.direction = "up";
    }
    return {
      ...base,
      params,
      timing: timingWithDefaults(seed.timing, {
        anchor: phase === "in" ? "enter" : "exit",
        offsetMs: 0,
        durationMs: DEFAULT_TRANSITION_MS,
        easing: defaultTransitionEasing(phase)
      })
    };
  }
});
var HEX_COLOR_PATTERN = "^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$";
var EFFECT_DEFAULTS = {
  shake: { distancePx: 10, periodMs: 400 },
  pulse: { scale: 1.1, periodMs: 1000 },
  float: { distancePx: 8, periodMs: 2000 },
  glow: { radiusPx: 12, color: "#ffffff", periodMs: 1500 },
  flash: { brightness: 1.8, periodMs: 800 },
  blur: { radiusPx: 8 }
};
var DISTANCE = {
  label: "Distance",
  input: "number",
  unit: "px",
  min: 1,
  max: 500,
  minExclusive: false,
  step: 1
};
var PERIOD = {
  label: "Cycle",
  input: "number",
  unit: "ms",
  min: 50,
  max: 60000,
  minExclusive: false,
  step: 50
};
var RADIUS = {
  label: "Radius",
  input: "number",
  unit: "px",
  min: 0,
  max: 200,
  minExclusive: true,
  step: 1
};
var COLOR = { label: "Color", input: "color", minExclusive: false, step: 1 };
function paramsOf(kind, shapes) {
  const defaults = EFFECT_DEFAULTS[kind];
  return Object.entries(shapes).map(([name, shape]) => ({
    name,
    ...shape,
    defaultValue: defaults[name]
  }));
}
var EFFECT_PARAMS = {
  shake: paramsOf("shake", { distancePx: DISTANCE, periodMs: PERIOD }),
  pulse: paramsOf("pulse", {
    scale: { label: "Scale", input: "number", unit: "×", min: 1, max: 3, minExclusive: false, step: 0.05 },
    periodMs: PERIOD
  }),
  float: paramsOf("float", { distancePx: DISTANCE, periodMs: PERIOD }),
  glow: paramsOf("glow", { color: COLOR, radiusPx: RADIUS, periodMs: PERIOD }),
  flash: paramsOf("flash", {
    brightness: { label: "Brightness", input: "number", unit: "×", min: 1, max: 5, minExclusive: false, step: 0.1 },
    periodMs: PERIOD
  }),
  blur: paramsOf("blur", { radiusPx: RADIUS })
};
function paramSpecOf(spec) {
  if (spec.input === "color") {
    return {
      valid: (v) => typeof v === "string" && new RegExp(HEX_COLOR_PATTERN).test(v),
      schema: { type: "string", pattern: HEX_COLOR_PATTERN }
    };
  }
  const { min, max, minExclusive } = spec;
  const schema = { type: "number" };
  if (min !== undefined) {
    schema[minExclusive ? "exclusiveMinimum" : "minimum"] = min;
  }
  if (max !== undefined) {
    schema.maximum = max;
  }
  return {
    valid: (v) => isFiniteNumber(v) && (min === undefined || (minExclusive ? v > min : v >= min)) && (max === undefined || v <= max),
    schema
  };
}
function hostParamsOf(table) {
  return Object.fromEntries(Object.entries(table).map(([kind, specs]) => [
    kind,
    Object.fromEntries(specs.map((spec) => [spec.name, paramSpecOf(spec)]))
  ]));
}
var EFFECT_TYPE = behaviorType({
  name: EFFECT_TYPE_NAME,
  hostKinds: HOST_EFFECT_KINDS,
  widgetKinds: true,
  commonParams: {},
  hostParams: hostParamsOf(EFFECT_PARAMS),
  canvasTarget: true,
  invalidTiming(timing) {
    if (timing.durationMs === 0) {
      return "an effect lasts some time";
    }
    return null;
  },
  timingSchema: {
    properties: {
      durationMs: { anyOf: [{ const: "until-exit" }, { type: "integer", minimum: 1, maximum: MAX_TIMING_MS }] }
    }
  },
  withDefaults(seed) {
    return {
      ...behaviorBase(seed, EFFECT_TYPE_NAME, "pulse"),
      timing: timingWithDefaults(seed.timing, {
        anchor: "enter",
        offsetMs: 0,
        durationMs: "until-exit",
        easing: "ease-in-out"
      })
    };
  }
});
var ACTIVITY_TYPE = behaviorType({
  name: ACTIVITY_TYPE_NAME,
  hostKinds: ACTIVITY_KINDS,
  widgetKinds: false,
  commonParams: {},
  hostParams: {},
  canvasTarget: false,
  invalidTiming: () => null,
  timingSchema: {},
  withDefaults(seed) {
    return {
      ...behaviorBase(seed, ACTIVITY_TYPE_NAME, "window"),
      timing: timingWithDefaults(seed.timing, {
        anchor: "start",
        offsetMs: 0,
        durationMs: "until-exit",
        easing: "linear"
      })
    };
  }
});
var BUILTIN_TYPES = [WIDGET_TYPE, TRANSITION_TYPE, EFFECT_TYPE, ACTIVITY_TYPE];

// ../shared/clients/typescript/scene/model/animation.ts
function isHostKind(type, kind) {
  if (type === "transition") {
    return HOST_TRANSITION_KINDS.includes(kind);
  }
  if (type === "effect") {
    return HOST_EFFECT_KINDS.includes(kind);
  }
  return false;
}
function compileAnimation(behavior, window2) {
  if (!isHostKind(behavior.type, behavior.kind)) {
    return null;
  }
  assertWindow(window2);
  if (behavior.type === "transition") {
    return compileTransition(behavior, window2);
  }
  return compileEffect(behavior, window2);
}
var SLIDE_OFFSET = {
  up: { enter: "translate(0, 100%)", leave: "translate(0, -100%)" },
  down: { enter: "translate(0, -100%)", leave: "translate(0, 100%)" },
  left: { enter: "translate(100%, 0)", leave: "translate(-100%, 0)" },
  right: { enter: "translate(-100%, 0)", leave: "translate(100%, 0)" }
};
var SHOWN = { opacity: 1, transform: "none" };
function compileTransition(behavior, window2) {
  const phase = behavior.params.phase;
  if (phase !== "in" && phase !== "out") {
    throw new Error(`animation: a transition's params.phase must be "in" or "out"`);
  }
  if (window2.endMs === null) {
    throw new Error("animation: a transition must have an end");
  }
  const kind = behavior.kind;
  const direction = slideDirection(behavior);
  return {
    layer: "transition",
    keyframes: transitionKeyframes(kind, phase, direction),
    timing: {
      duration: window2.endMs - window2.startMs,
      easing: behavior.timing.easing,
      delay: window2.startMs,
      fill: "both",
      iterations: 1
    }
  };
}
function transitionKeyframes(kind, phase, direction = "up") {
  const entrance = entranceKeyframes(kind, phase, direction);
  if (phase === "in") {
    return entrance;
  }
  return entrance.slice().reverse().map((frame) => frame.offset === undefined ? frame : { ...frame, offset: 1 - frame.offset });
}
function entranceKeyframes(kind, phase, direction) {
  switch (kind) {
    case "fade":
      return [
        { opacity: 0, transform: "none" },
        { opacity: 1, transform: "none" }
      ];
    case "slide": {
      const offset = SLIDE_OFFSET[direction];
      return [{ opacity: 0, transform: phase === "in" ? offset.enter : offset.leave }, { ...SHOWN }];
    }
    case "zoom":
      return [{ opacity: 0, transform: "scale(0.5)" }, { ...SHOWN }];
    case "bounce":
      return [
        { opacity: 0, transform: "scale(0.3)" },
        { opacity: 1, transform: "scale(1.08)", offset: 0.5 },
        { opacity: 1, transform: "scale(0.94)", offset: 0.75 },
        { ...SHOWN }
      ];
    case "spin":
      return [{ opacity: 0, transform: "rotate(-360deg) scale(0)" }, { ...SHOWN }];
    case "pop":
      return [
        { opacity: 0, transform: "scale(0)" },
        { opacity: 1, transform: "scale(1.15)", offset: 0.7 },
        { ...SHOWN }
      ];
    case "blur":
      return [
        { opacity: 0, transform: "none", filter: "blur(16px)" },
        { ...SHOWN, filter: "none" }
      ];
    default:
      throw new Error(`animation: no keyframes for transition ${String(kind)}`);
  }
}
function slideDirection(behavior) {
  const direction = behavior.params.direction;
  if (direction === undefined) {
    return "up";
  }
  if (!TRANSITION_DIRECTIONS.includes(direction)) {
    throw new Error(`animation: params.direction must be one of ${TRANSITION_DIRECTIONS.join(", ")}`);
  }
  return direction;
}
var HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
function compileEffect(behavior, window2) {
  const kind = behavior.kind;
  const length = window2.endMs === null ? Number.POSITIVE_INFINITY : window2.endMs - window2.startMs;
  const { keyframes, periodMs } = effectCycle(kind, behavior.params);
  const duration = periodMs ?? length;
  const iterations = periodMs === null ? 1 : length / periodMs;
  return {
    layer: "effect",
    keyframes,
    timing: {
      duration,
      easing: behavior.timing.easing,
      delay: window2.startMs,
      fill: "none",
      iterations
    }
  };
}
function effectCycle(kind, params) {
  switch (kind) {
    case "shake": {
      const distance = positiveParam(params, "distancePx", EFFECT_DEFAULTS.shake.distancePx);
      const at = (x, offset) => offset === undefined ? { transform: `translateX(${x}px)` } : { transform: `translateX(${x}px)`, offset };
      return {
        keyframes: [at(0), at(-distance, 0.2), at(distance, 0.4), at(-distance, 0.6), at(distance, 0.8), at(0)],
        periodMs: positiveParam(params, "periodMs", EFFECT_DEFAULTS.shake.periodMs)
      };
    }
    case "pulse": {
      const scale = positiveParam(params, "scale", EFFECT_DEFAULTS.pulse.scale);
      return {
        keyframes: [
          { transform: "scale(1)" },
          { transform: `scale(${scale})`, offset: 0.5 },
          { transform: "scale(1)" }
        ],
        periodMs: positiveParam(params, "periodMs", EFFECT_DEFAULTS.pulse.periodMs)
      };
    }
    case "glow": {
      const radius = positiveParam(params, "radiusPx", EFFECT_DEFAULTS.glow.radiusPx);
      const color = colorParam(params, "color", EFFECT_DEFAULTS.glow.color);
      return {
        keyframes: [
          { filter: `drop-shadow(0 0 0px ${color})` },
          { filter: `drop-shadow(0 0 ${radius}px ${color})`, offset: 0.5 },
          { filter: `drop-shadow(0 0 0px ${color})` }
        ],
        periodMs: positiveParam(params, "periodMs", EFFECT_DEFAULTS.glow.periodMs)
      };
    }
    case "float": {
      const distance = positiveParam(params, "distancePx", EFFECT_DEFAULTS.float.distancePx);
      return {
        keyframes: [
          { transform: "translateY(0px)" },
          { transform: `translateY(${-distance}px)`, offset: 0.5 },
          { transform: "translateY(0px)" }
        ],
        periodMs: positiveParam(params, "periodMs", EFFECT_DEFAULTS.float.periodMs)
      };
    }
    case "flash": {
      const brightness = positiveParam(params, "brightness", EFFECT_DEFAULTS.flash.brightness);
      return {
        keyframes: [
          { filter: "brightness(1)" },
          { filter: `brightness(${brightness})`, offset: 0.5 },
          { filter: "brightness(1)" }
        ],
        periodMs: positiveParam(params, "periodMs", EFFECT_DEFAULTS.flash.periodMs)
      };
    }
    case "blur": {
      const radius = positiveParam(params, "radiusPx", EFFECT_DEFAULTS.blur.radiusPx);
      return {
        keyframes: [{ filter: `blur(${radius}px)` }, { filter: `blur(${radius}px)` }],
        periodMs: null
      };
    }
    default:
      throw new Error(`animation: no keyframes for effect ${String(kind)}`);
  }
}
function positiveParam(params, name, fallback) {
  const value = params[name];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`animation: params.${name} must be a positive number`);
  }
  return value;
}
function colorParam(params, name, fallback) {
  const value = params[name];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string" || !HEX_COLOR.test(value)) {
    throw new Error(`animation: params.${name} must be a hex colour`);
  }
  return value;
}
function assertWindow(window2) {
  if (!Number.isFinite(window2.startMs)) {
    throw new Error("animation: window.startMs must be a finite number");
  }
  if (window2.endMs !== null && !(Number.isFinite(window2.endMs) && window2.endMs >= window2.startMs)) {
    throw new Error("animation: window.endMs must be a finite number no earlier than startMs");
  }
}
// ../shared/clients/typescript/scene/model/keys.ts
var DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
var BASE = DIGITS.length;
var FIRST_KEY = DIGITS[BASE / 2];
function evenKeys(n) {
  assert(Number.isSafeInteger(n) && n >= 0 && n <= BASE ** 4, "too many entries to number");
  const keys = [];
  for (let i = 0;i < n; i++) {
    keys.push(`a${(i + 1).toString(BASE).padStart(4, "0")}`);
  }
  return keys;
}
function compareKeyed(a, b) {
  if (a.key !== b.key) {
    return a.key < b.key ? -1 : 1;
  }
  if (a.id !== b.id) {
    return a.id < b.id ? -1 : 1;
  }
  return 0;
}
function orderByKey(entries, keyOf) {
  return Object.entries(entries).map(([id, entry]) => ({ id, key: keyOf(entry) })).sort(compareKeyed).map(({ id }) => id);
}
function stackOrder(doc) {
  return orderByKey(doc.widgets, (placement) => placement.z);
}
// ../shared/clients/typescript/scene/model/legacy-alert.ts
function isLegacyAlertLayout(value) {
  return isPlainObject(value) && Array.isArray(value.widgets);
}
function compositionOfLegacyAlert(legacy) {
  const { widgets: entries, ...canvas } = legacy;
  const kept = [];
  const skipped = [];
  const seen = new Set;
  entries.forEach((raw, index) => {
    const entry = isPlainObject(raw) ? raw : {};
    const widgetCanonicalId = typeof entry.widgetCanonicalId === "string" ? entry.widgetCanonicalId : "";
    const id = typeof entry.id === "string" ? entry.id : "";
    if (!isPlainObject(raw)) {
      skipped.push({ index, widgetCanonicalId, reason: "a layout widget must be an object" });
      return;
    }
    if (id.length === 0) {
      skipped.push({ index, widgetCanonicalId, reason: "a layout widget needs an `id`" });
      return;
    }
    if (seen.has(id)) {
      skipped.push({ index, widgetCanonicalId, reason: `duplicate id ${JSON.stringify(id)}` });
      return;
    }
    seen.add(id);
    kept.push({ id, index, entry });
  });
  const zKeys = evenKeys(kept.length);
  const widgets = {};
  const indexOf = {};
  stackingOrder(kept).forEach(({ id, index, entry }, rank) => {
    widgets[id] = placementOf(entry, zKeys[rank]);
    indexOf[id] = index;
  });
  return { doc: { layout: canvas, widgets, behaviors: {} }, indexOf, skipped };
}
function stackingOrder(kept) {
  const zIndexed = kept.every(({ entry }) => isFiniteNumber2(entry.zIndex));
  if (!zIndexed) {
    return kept;
  }
  return [...kept].sort((a, b) => a.entry.zIndex - b.entry.zIndex);
}
function alertCompositionOf(value) {
  if (isLegacyAlertLayout(value)) {
    return compositionOfLegacyAlert(value).doc;
  }
  return normalizeComposition(value);
}
var LEGACY_ENTRY_FIELDS = new Set([
  "id",
  "widgetCanonicalId",
  "position",
  "size",
  "settings",
  "name",
  "visible",
  "rotation",
  "opacity",
  "locked",
  "zIndex"
]);
function placementOf(entry, z) {
  const position = isPlainObject(entry.position) ? entry.position : {};
  const size = isPlainObject(entry.size) ? entry.size : {};
  const extra = {};
  for (const [key, value] of Object.entries(entry)) {
    if (!LEGACY_ENTRY_FIELDS.has(key)) {
      extra[key] = value;
    }
  }
  return {
    widget: typeof entry.widgetCanonicalId === "string" ? entry.widgetCanonicalId : "",
    x: numberOr(position.x, 0),
    y: numberOr(position.y, 0),
    width: numberOr(position.width, numberOr(size.width, 0)),
    height: numberOr(position.height, numberOr(size.height, 0)),
    visible: typeof entry.visible === "boolean" ? entry.visible : true,
    z,
    settings: isPlainObject(entry.settings) ? entry.settings : {},
    name: typeof entry.name === "string" && entry.name.length <= PLACEMENT_NAME_MAX_LENGTH ? entry.name : "",
    rotation: numberOr(entry.rotation, 0),
    opacity: isFiniteNumber2(entry.opacity) && entry.opacity >= 0 && entry.opacity <= 1 ? entry.opacity : 1,
    locked: typeof entry.locked === "boolean" ? entry.locked : false,
    extra
  };
}
function isFiniteNumber2(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function numberOr(value, fallback) {
  return isFiniteNumber2(value) ? value : fallback;
}
// ../shared/clients/typescript/scene/model/registry.ts
var DEFAULT_WIDGET_TRAITS = { keepsAspect: false, heightFollowsText: false };

class TypeRegistry {
  mode;
  collections;
  types;
  traits;
  constructor(mode, collections, types, widgetTraits = {}) {
    const byName = new Map;
    for (const collection of collections) {
      assert(!byName.has(collection.name), `collection ${collection.name} is defined once`);
      byName.set(collection.name, collection);
    }
    const byKey = new Map;
    for (const type of types) {
      assert(byName.has(type.collection), `type ${type.name} belongs to a defined collection`);
      const key = typeKey(type.collection, type.name);
      assert(!byKey.has(key), `type ${key} is registered once`);
      byKey.set(key, type);
    }
    this.mode = mode;
    this.collections = byName;
    this.types = byKey;
    this.traits = new Map(Object.entries(widgetTraits).map(([widgetId, traits]) => [widgetId, { ...DEFAULT_WIDGET_TRAITS, ...traits }]));
  }
  widgetTraits(widgetId) {
    return this.traits.get(widgetId) ?? DEFAULT_WIDGET_TRAITS;
  }
  isCollection(name) {
    return typeof name === "string" && this.collections.has(name);
  }
  collection(name) {
    const collection = this.collections.get(name);
    assert(collection !== undefined, `collection ${name} is defined`);
    return collection;
  }
  collectionNames() {
    return [...this.collections.keys()];
  }
  field(collection, field2) {
    const fields = this.collection(collection).fields;
    return Object.hasOwn(fields, field2) ? fields[field2] : undefined;
  }
  type(collection, name) {
    return this.types.get(typeKey(collection, name));
  }
  typesOf(collection) {
    return [...this.types.values()].filter((type) => type.collection === collection);
  }
  executorOf(type, kind) {
    return this.type("behaviors", type)?.executorOf?.(kind) ?? null;
  }
  hasExactFields(collection, value) {
    if (!isPlainObject(value)) {
      return false;
    }
    const fields = this.collection(collection).fields;
    const keys = Object.keys(value);
    return keys.length === Object.keys(fields).length && keys.every((key) => Object.hasOwn(fields, key));
  }
  invalidEntry(collection, value) {
    const definition = this.collection(collection);
    if (!isPlainObject(value)) {
      return `a ${definition.noun} must be an object`;
    }
    const typeName = definition.typeOf(value);
    const type = typeName === null ? undefined : this.type(collection, typeName);
    if (type === undefined) {
      if (this.mode === "tolerant" && typeName !== null) {
        return null;
      }
      return `unknown ${definition.noun} type ${JSON.stringify(typeName)}`;
    }
    for (const [field2, spec] of Object.entries(definition.fields)) {
      if (!Object.hasOwn(value, field2)) {
        return `a ${definition.noun} needs ${field2}`;
      }
      if (!spec.valid(value[field2], this.mode)) {
        return `invalid ${definition.noun} ${field2}`;
      }
    }
    if (this.mode === "strict") {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(definition.fields, key)) {
          return `a ${definition.noun} has no field ${key}`;
        }
      }
    }
    return type.invalid(value, this.mode);
  }
  isEntry(collection, value) {
    return this.invalidEntry(collection, value) === null;
  }
  invalidField(collection, field2, value) {
    const definition = this.collection(collection);
    const spec = this.field(collection, field2);
    if (spec === undefined) {
      return `a ${definition.noun} has no field ${field2}`;
    }
    if (spec.grain === "fixed") {
      return `a ${definition.noun}'s ${field2} changes only with the whole ${definition.noun}`;
    }
    return spec.valid(value, this.mode) ? null : `invalid ${definition.noun} ${field2}`;
  }
  invalidSubfield(collection, field2, subfield, change) {
    const spec = this.field(collection, field2);
    if (spec === undefined || spec.grain !== "struct" || spec.subfields === undefined) {
      return `${field2} has no fields of its own`;
    }
    const sub = Object.hasOwn(spec.subfields, subfield) ? spec.subfields[subfield] : undefined;
    if (sub === undefined) {
      return `${field2} has no field ${subfield}`;
    }
    if (!sub.optional && !(change.inserts && change.removes)) {
      return `${field2}.${subfield} can only be replaced`;
    }
    if (change.inserts && !sub.valid(change.value)) {
      return `invalid ${field2}.${subfield}`;
    }
    return null;
  }
  invalidLayoutKey(key, value) {
    if (CANVAS_SIZE_KEYS.has(key)) {
      if (value === undefined) {
        return `a canvas keeps its ${key}`;
      }
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        return `a canvas ${key} is a positive number`;
      }
      return null;
    }
    if (key === "backgroundColor" && value !== undefined && typeof value !== "string") {
      return "a canvas backgroundColor is a string";
    }
    return null;
  }
  invalidEdit(before, after) {
    if (!isCompositionShape(after)) {
      return "a composition has a layout, and widgets and behaviors keyed by id";
    }
    for (const key of new Set([...Object.keys(before.layout), ...Object.keys(after.layout)])) {
      const value = Object.hasOwn(after.layout, key) ? after.layout[key] : undefined;
      const was = Object.hasOwn(before.layout, key) ? before.layout[key] : undefined;
      if (sameValue(was, value)) {
        continue;
      }
      const invalid = this.invalidLayoutKey(key, value);
      if (invalid !== null) {
        return invalid;
      }
    }
    for (const collection of this.collectionNames()) {
      const was = before[collection];
      const is = after[collection];
      const noun = this.collection(collection).noun;
      for (const [id, entry] of Object.entries(is)) {
        if (Object.hasOwn(was, id) && sameValue(was[id], entry)) {
          continue;
        }
        if (id.length === 0 || id.length > ENTRY_ID_MAX_LENGTH) {
          return `a ${noun} id is 1 to ${ENTRY_ID_MAX_LENGTH} characters`;
        }
        const invalid = this.invalidEntry(collection, entry);
        if (invalid !== null) {
          return `${noun} ${id} would not be valid: ${invalid}`;
        }
      }
    }
    return null;
  }
  create(collection, type, seed) {
    const built = this.tryCreate(collection, type, seed);
    assert(built.ok, `a new ${type} is valid: ${built.ok ? "" : built.detail}`);
    return built.entry;
  }
  tryCreate(collection, type, seed) {
    const entityType = this.type(collection, type);
    if (entityType === undefined) {
      return { ok: false, detail: `there is no ${this.collection(collection).noun} type ${type}` };
    }
    const entry = entityType.withDefaults(seed);
    const invalid = this.invalidEntry(collection, entry);
    return invalid === null ? { ok: true, entry } : { ok: false, detail: invalid };
  }
  migrateDocument(doc) {
    const next = { ...doc, widgets: { ...doc.widgets }, behaviors: { ...doc.behaviors } };
    for (const collection of this.collectionNames()) {
      const entries = next[collection];
      for (const [id, value] of Object.entries(entries)) {
        if (!isPlainObject(value)) {
          continue;
        }
        const typeName = this.collection(collection).typeOf(value);
        const type = typeName === null ? undefined : this.type(collection, typeName);
        if (type?.migrate === undefined) {
          continue;
        }
        const migrated = type.migrate(value, id);
        entries[id] = migrated.entry;
        for (const [behaviorId, behavior] of Object.entries(migrated.behaviors ?? {})) {
          if (!Object.hasOwn(next.behaviors, behaviorId)) {
            next.behaviors[behaviorId] = behavior;
          }
        }
      }
    }
    return next;
  }
}
var CANVAS_SIZE_KEYS = new Set(["width", "height"]);
function typeKey(collection, name) {
  return `${collection}/${name}`;
}
function createRegistry(mode, extra = [], extraWidgetTraits = {}) {
  for (const widgetId of Object.keys(extraWidgetTraits)) {
    assert(!Object.hasOwn(BUILTIN_WIDGET_TRAITS, widgetId), `widget ${widgetId} declares its traits once`);
  }
  return new TypeRegistry(mode, BUILTIN_COLLECTIONS, [...BUILTIN_TYPES, ...extra], {
    ...BUILTIN_WIDGET_TRAITS,
    ...extraWidgetTraits
  });
}
var STRICT_REGISTRY = createRegistry("strict");
var TOLERANT_REGISTRY = createRegistry("tolerant");
// ../shared/clients/typescript/scene/model/timeline.ts
var UNTIMED_ALERT_MS = 5000;
var SUBSCRIBE_TIMEOUT_MS = 1e4;
var MAX_ALERT_MS = 5 * 60000;
var RENDER_WAIT_MS = 2000;
var MEDIA_WIDGETS = new Set([
  "woofx3:widget:video",
  "woofx3:widget:audio",
  "woofx3:widget:lottie"
]);
var NEVER = Number.POSITIVE_INFINITY;
function resolveTimeline(doc, profile, facts, options = {}) {
  return new Resolver(doc, profile, facts, options).resolve();
}

class Resolver {
  doc;
  profile;
  facts;
  bounded;
  now;
  estimate;
  widgetIds;
  behaviorIds;
  problems = [];
  activities = new Map;
  afterEnd = new Set;
  leads = new Map;
  planned = new Map;
  endMemo = null;
  constructor(doc, profile, facts, options) {
    this.doc = doc;
    this.profile = profile;
    this.facts = facts;
    assertFinite(facts.startedAtMs, "facts.startedAtMs");
    this.bounded = profile.bounded;
    this.now = facts.nowMs === undefined ? null : this.relative(facts.nowMs, "facts.nowMs");
    this.estimate = options.estimate ?? null;
    this.widgetIds = Object.keys(doc.widgets).sort();
    this.behaviorIds = Object.keys(doc.behaviors).sort();
    this.checkFacts();
    this.chooseActivities();
    this.computeLeads();
  }
  resolve() {
    const widgets = {};
    for (const id of this.widgetIds) {
      const departure = this.departure(id);
      widgets[id] = {
        status: this.status(id),
        enterMs: known(this.enter(id)),
        completeMs: known(this.rawComplete(id)),
        leaveMs: known(departure.leave),
        exitMs: known(departure.exit)
      };
    }
    const behaviors = {};
    for (const id of this.behaviorIds) {
      const behavior = this.doc.behaviors[id];
      if (!this.targetExists(behavior.target)) {
        this.problem(id, "dangling-target");
        continue;
      }
      const window2 = this.behaviorWindow(id, behavior);
      behaviors[id] = { startMs: known(window2.start), endMs: known(window2.end) };
    }
    const canvas = this.canvasDeparture();
    return {
      widgets,
      behaviors,
      canvas: { enterMs: 0, leaveMs: known(canvas.leave), exitMs: known(canvas.exit) },
      endMs: this.bounded ? known(this.end()) : null,
      finishMs: this.bounded ? known(this.finish()) : null,
      revisitAtMs: this.revisitAt(),
      problems: this.problems.sort((a, b) => compareText(a.behavior, b.behavior) || compareText(a.kind, b.kind))
    };
  }
  checkFacts() {
    const widgets = this.facts.widgets ?? {};
    for (const [id, widget] of Object.entries(widgets)) {
      for (const key of ["subscribedAtMs", "renderedAtMs", "completedAtMs"]) {
        if (widget[key] !== undefined) {
          assertFinite(widget[key], `facts.widgets.${id}.${key}`);
        }
      }
      if (widget.subscribedAtMs !== undefined && typeof widget.timed !== "boolean") {
        throw new Error(`timeline: facts.widgets.${id} subscribed without saying whether it is timed`);
      }
      for (const change of widget.visibility ?? []) {
        assertFinite(change.atMs, `facts.widgets.${id}.visibility.atMs`);
      }
    }
    for (const [id, duration] of Object.entries(this.estimate?.durationsMs ?? {})) {
      if (duration !== null && !(Number.isFinite(duration) && duration >= 0)) {
        throw new Error(`timeline: estimate.durationsMs.${id} must be a non-negative number or null`);
      }
    }
  }
  chooseActivities() {
    const byTarget = new Map;
    for (const id of this.behaviorIds) {
      const behavior = this.doc.behaviors[id];
      if (behavior.type !== "activity" || !this.targetExists(behavior.target)) {
        continue;
      }
      if (behavior.target === CANVAS_TARGET) {
        this.problem(id, "invalid-activity");
        continue;
      }
      const ids = byTarget.get(behavior.target) ?? [];
      ids.push(id);
      byTarget.set(behavior.target, ids);
    }
    for (const [target, ids] of byTarget) {
      ids.sort((a, b) => compareOrder(this.doc.behaviors[a], a, this.doc.behaviors[b], b));
      for (const extra of ids.slice(1)) {
        this.problem(extra, "duplicate-activity");
      }
      const id = ids[0];
      const behavior = this.doc.behaviors[id];
      const { anchor, node } = behavior.timing;
      if (!this.profile.anchors.includes(anchor)) {
        this.problem(id, "anchor-not-in-profile");
        continue;
      }
      const selfAnchored = anchor === "enter" || anchor === "exit";
      const badCompletion = anchor === "complete" && (node === undefined || node === target || !(node in this.doc.widgets));
      if (selfAnchored || badCompletion) {
        this.problem(id, "invalid-activity");
        continue;
      }
      this.activities.set(target, behavior);
    }
    this.dropActivityCycles();
    for (const id of this.widgetIds) {
      if (this.waitsOnEnd(id, new Set)) {
        this.afterEnd.add(id);
      }
    }
  }
  dropActivityCycles() {
    const state = new Map;
    const inCycle = new Set;
    const visit = (id, path) => {
      const seen = state.get(id);
      if (seen === "done") {
        return;
      }
      if (seen === "visiting") {
        for (const member of path.slice(path.indexOf(id))) {
          inCycle.add(member);
        }
        return;
      }
      state.set(id, "visiting");
      const next = this.completionDependency(id);
      if (next !== null) {
        visit(next, [...path, id]);
      }
      state.set(id, "done");
    };
    for (const id of this.widgetIds) {
      visit(id, []);
    }
    for (const id of [...inCycle].sort()) {
      const activity = this.activities.get(id);
      if (activity) {
        const behaviorId = this.behaviorIds.find((candidate) => this.doc.behaviors[candidate] === activity);
        if (behaviorId === undefined) {
          throw new Error("timeline: chosen activity is not in the document");
        }
        this.problem(behaviorId, "activity-cycle");
        this.activities.delete(id);
      }
    }
  }
  completionDependency(id) {
    const activity = this.activities.get(id);
    if (!activity || activity.timing.anchor !== "complete" || activity.timing.node === undefined) {
      return null;
    }
    return activity.timing.node;
  }
  waitsOnEnd(id, seen) {
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    const activity = this.activities.get(id);
    if (!activity) {
      return false;
    }
    if (activity.timing.anchor === "end") {
      return true;
    }
    const next = this.completionDependency(id);
    return next !== null && this.waitsOnEnd(next, seen);
  }
  computeLeads() {
    for (const id of this.behaviorIds) {
      const behavior = this.doc.behaviors[id];
      if (behavior.type === "activity" || !this.targetExists(behavior.target)) {
        continue;
      }
      const { timing } = behavior;
      let lead = 0;
      if (phaseOf(behavior) === "out") {
        if (typeof timing.durationMs === "number") {
          lead = timing.durationMs - timing.offsetMs;
        }
      } else if (phaseOf(behavior) === null && timing.anchor === "exit" && timing.offsetMs < 0) {
        lead = -timing.offsetMs;
      }
      const current = this.leads.get(behavior.target) ?? 0;
      this.leads.set(behavior.target, Math.max(current, lead));
    }
  }
  plannedEnter(id) {
    if (this.planned.has(id)) {
      return this.planned.get(id);
    }
    let time;
    const activity = this.activities.get(id);
    const activityStart = activity ? this.activityStart(activity) : 0;
    if (this.bounded && !this.doc.widgets[id].visible) {
      time = NEVER;
    } else if (this.bounded) {
      time = activityStart === null ? null : Math.max(0, activityStart);
    } else {
      const shown = this.visibleWindow(id).show;
      time = shown === null || activityStart === null ? null : Math.max(shown, activityStart);
    }
    this.planned.set(id, time);
    return time;
  }
  activityStart(activity) {
    const { anchor, node, offsetMs } = activity.timing;
    switch (anchor) {
      case "start":
        return offsetMs;
      case "end":
        return add(this.end(), offsetMs);
      case "complete":
        return add(this.completeForAnchor(node), offsetMs);
      default:
        throw new Error(`timeline: activity anchored to ${anchor} was not filtered out`);
    }
  }
  activityClose(id) {
    const activity = this.activities.get(id);
    if (!activity || activity.timing.durationMs === "until-exit") {
      return;
    }
    return add(this.activityStart(activity), activity.timing.durationMs);
  }
  enter(id) {
    const planned = this.plannedEnter(id);
    if (planned === null || planned === NEVER) {
      return planned;
    }
    const rendered = this.fact(id, "renderedAtMs");
    if (rendered !== null) {
      return rendered <= planned ? planned : Math.min(rendered, planned + RENDER_WAIT_MS);
    }
    if (this.estimate !== null) {
      return planned;
    }
    return this.passed(planned + RENDER_WAIT_MS) ? planned + RENDER_WAIT_MS : null;
  }
  status(id) {
    const planned = this.plannedEnter(id);
    if (planned === NEVER) {
      return "never";
    }
    const subscribed = this.fact(id, "subscribedAtMs");
    if (subscribed !== null) {
      if (this.bounded && planned !== null && subscribed > planned + SUBSCRIBE_TIMEOUT_MS) {
        return "ignored";
      }
      return this.facts.widgets?.[id]?.timed ? "timed" : "untimed";
    }
    if (this.estimate !== null) {
      return this.estimatedLength(id) === null ? "untimed" : "timed";
    }
    if (this.bounded && planned !== null && this.passed(planned + SUBSCRIBE_TIMEOUT_MS)) {
      return "ignored";
    }
    return "pending";
  }
  estimatedLength(id) {
    const durations = this.estimate?.durationsMs ?? {};
    if (Object.hasOwn(durations, id)) {
      return durations[id];
    }
    const seconds = this.doc.widgets[id].settings.duration;
    if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000;
    }
    return null;
  }
  rawComplete(id) {
    const planned = this.plannedEnter(id);
    if (planned === NEVER) {
      return NEVER;
    }
    const completed = this.fact(id, "completedAtMs");
    if (completed !== null) {
      return completed;
    }
    const status = this.status(id);
    if (status === "ignored") {
      return NEVER;
    }
    const subscribed = this.fact(id, "subscribedAtMs");
    if (status === "untimed" && subscribed !== null) {
      return planned === null ? subscribed : Math.max(planned, subscribed);
    }
    if (this.estimate !== null && planned !== null) {
      return planned + (this.estimatedLength(id) ?? 0);
    }
    return null;
  }
  completeForAnchor(id) {
    const raw = this.rawComplete(id);
    if (raw === null && this.bounded && this.passed(MAX_ALERT_MS)) {
      return NEVER;
    }
    return raw;
  }
  departure(id) {
    const planned = this.plannedEnter(id);
    if (planned === null || planned === NEVER) {
      return { leave: planned, exit: planned };
    }
    return this.bounded ? this.alertDeparture(id, planned) : this.sceneDeparture(id, planned);
  }
  alertDeparture(id, planned) {
    const lead = this.leads.get(id) ?? 0;
    const close = this.activityClose(id);
    const end = this.end();
    if (close !== undefined) {
      if (close === null) {
        return { leave: null, exit: null };
      }
      if (!this.afterEnd.has(id) && close > MAX_ALERT_MS) {
        return { leave: end, exit: add(end, lead) };
      }
      return { leave: Math.max(planned, close - lead), exit: close };
    }
    let leave;
    if (this.afterEnd.has(id)) {
      leave = end === null ? null : Math.max(planned, end);
    } else if (this.status(id) === "timed") {
      const completed = this.rawComplete(id);
      if (completed !== null) {
        leave = end === null ? completed : Math.min(completed, end);
      } else {
        leave = end;
      }
    } else {
      leave = end;
    }
    return { leave, exit: add(leave, lead) };
  }
  sceneDeparture(id, planned) {
    const lead = this.leads.get(id) ?? 0;
    const hidden = this.visibleWindow(id).hide;
    const close = this.activityClose(id);
    if (close === null) {
      return { leave: null, exit: null };
    }
    const candidates = [];
    if (hidden !== null) {
      candidates.push({ leave: hidden, exit: hidden + lead });
    }
    if (close !== undefined) {
      candidates.push({ leave: Math.max(planned, close - lead), exit: close });
    }
    if (candidates.length === 0) {
      return { leave: null, exit: null };
    }
    candidates.sort((a, b) => a.exit - b.exit);
    return candidates[0];
  }
  visibleWindow(id) {
    const changes = (this.facts.widgets?.[id]?.visibility ?? []).map((change, index) => ({ at: this.relative(change.atMs, "visibility.atMs"), visible: change.visible, index })).sort((a, b) => a.at - b.at || a.index - b.index);
    let visible = this.doc.widgets[id].visible;
    let show = visible ? 0 : null;
    let hide = null;
    for (const change of changes) {
      if (change.visible && !visible) {
        show = change.at;
        hide = null;
      } else if (!change.visible && visible) {
        hide = change.at;
      }
      visible = change.visible;
    }
    return { show, hide };
  }
  end() {
    if (!this.bounded) {
      return null;
    }
    if (this.endMemo !== null) {
      return this.endMemo.value;
    }
    let unknown = false;
    let latest = 0;
    let anyHolds = false;
    for (const id of this.widgetIds) {
      if (this.afterEnd.has(id)) {
        continue;
      }
      const release = this.release(id);
      if (release === null) {
        unknown = true;
        continue;
      }
      if (release.time === NEVER) {
        continue;
      }
      latest = Math.max(latest, release.time);
      anyHolds = anyHolds || release.holds;
    }
    let value;
    if (!unknown) {
      value = Math.min(MAX_ALERT_MS, anyHolds ? latest : Math.max(latest, UNTIMED_ALERT_MS));
    } else if (latest >= MAX_ALERT_MS || this.passed(MAX_ALERT_MS)) {
      value = MAX_ALERT_MS;
    } else {
      value = null;
    }
    this.endMemo = { value };
    return value;
  }
  release(id) {
    const planned = this.plannedEnter(id);
    if (planned === null) {
      return null;
    }
    if (planned === NEVER) {
      return { time: NEVER, holds: false };
    }
    const close = this.activityClose(id);
    if (close !== undefined) {
      return close === null ? null : { time: close, holds: true };
    }
    const status = this.status(id);
    switch (status) {
      case "pending":
        return null;
      case "ignored":
        return { time: planned + SUBSCRIBE_TIMEOUT_MS, holds: false };
      case "untimed":
        return { time: this.rawComplete(id), holds: false };
      case "timed": {
        const completed = this.rawComplete(id);
        return completed === null ? null : { time: completed, holds: true };
      }
      default:
        throw new Error(`timeline: widget ${id} has unexpected status ${status}`);
    }
  }
  canvasDeparture() {
    if (!this.bounded) {
      return { leave: null, exit: null };
    }
    const end = this.end();
    return { leave: end, exit: add(end, this.leads.get(CANVAS_TARGET) ?? 0) };
  }
  finish() {
    let latest = this.canvasDeparture().exit;
    if (latest === null) {
      return null;
    }
    for (const id of this.widgetIds) {
      const { exit } = this.departure(id);
      if (exit === null) {
        return null;
      }
      if (exit !== NEVER) {
        latest = Math.max(latest, exit);
      }
    }
    return latest;
  }
  revisitAt() {
    if (this.now === null || this.estimate !== null) {
      return null;
    }
    const deadlines = [];
    for (const id of this.widgetIds) {
      const planned = this.plannedEnter(id);
      if (planned === null || planned === NEVER) {
        continue;
      }
      if (this.bounded && this.status(id) === "pending") {
        deadlines.push(planned + SUBSCRIBE_TIMEOUT_MS);
      }
      if (this.enter(id) === null) {
        deadlines.push(planned + RENDER_WAIT_MS);
      }
    }
    if (this.bounded && this.end() === null) {
      deadlines.push(MAX_ALERT_MS);
    }
    const future = deadlines.filter((deadline) => deadline > this.now);
    return future.length === 0 ? null : Math.min(...future);
  }
  behaviorWindow(id, behavior) {
    const { timing, target } = behavior;
    if (behavior.type === "activity") {
      return this.activityWindow(behavior);
    }
    const phase = phaseOf(behavior);
    if (phase === null && !this.profile.anchors.includes(timing.anchor)) {
      this.problem(id, "anchor-not-in-profile");
      return { start: null, end: null };
    }
    const enter = target === CANVAS_TARGET ? 0 : this.enter(target);
    const departure = target === CANVAS_TARGET ? this.canvasDeparture() : this.departure(target);
    if (phase === "in") {
      const start2 = add(enter, timing.offsetMs);
      return { start: start2, end: timing.durationMs === "until-exit" ? departure.exit : add(start2, timing.durationMs) };
    }
    if (phase === "out") {
      if (timing.durationMs === "until-exit") {
        return { start: departure.leave, end: departure.exit };
      }
      const end = add(departure.exit, timing.offsetMs);
      return { start: add(end, -timing.durationMs), end };
    }
    let anchor;
    switch (timing.anchor) {
      case "start":
        anchor = 0;
        break;
      case "end":
        anchor = this.end();
        break;
      case "enter":
        anchor = enter;
        break;
      case "exit":
        anchor = departure.exit;
        break;
      case "complete": {
        const node = timing.node ?? target;
        anchor = node === CANVAS_TARGET || !(node in this.doc.widgets) ? NEVER : this.completeForAnchor(node);
        break;
      }
      default:
        throw new Error(`timeline: unknown anchor ${String(timing.anchor)}`);
    }
    const start = add(anchor, timing.offsetMs);
    return { start, end: timing.durationMs === "until-exit" ? departure.exit : add(start, timing.durationMs) };
  }
  activityWindow(behavior) {
    if (behavior.target === CANVAS_TARGET) {
      return { start: null, end: null };
    }
    const target = behavior.target;
    return { start: this.enter(target), end: this.departure(target).exit };
  }
  targetExists(target) {
    return target === CANVAS_TARGET || Object.hasOwn(this.doc.widgets, target);
  }
  fact(id, key) {
    const value = this.facts.widgets?.[id]?.[key];
    return value === undefined ? null : this.relative(value, key);
  }
  relative(clock, name) {
    assertFinite(clock, name);
    return clock - this.facts.startedAtMs;
  }
  passed(time) {
    return this.now !== null && this.now >= time;
  }
  problem(behavior, kind) {
    this.problems.push({ behavior, kind });
  }
}
function phaseOf(behavior) {
  if (behavior.type !== "transition") {
    return null;
  }
  const phase = behavior.params.phase;
  return phase === "in" || phase === "out" ? phase : null;
}
function compareOrder(a, aId, b, bId) {
  if (a.order !== b.order) {
    return a.order < b.order ? -1 : 1;
  }
  return compareText(aId, bId);
}
function compareText(a, b) {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
function add(time, ms) {
  return time === null ? null : time + ms;
}
function known(time) {
  return time === null || time === NEVER ? null : time;
}
function assertFinite(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`timeline: ${name} must be a finite number`);
  }
}
// ../shared/clients/typescript/scene/runtime/diff.ts
var LAYERS = ["transition", "effect"];
var EMPTY_LAYERS = { transition: [], effect: [] };
function diffPlans(prev, next) {
  const removals = [];
  const mounts = [];
  const writes = [];
  const cancels = [];
  const starts = [];
  const delegates = [];
  const before = prev?.widgets ?? {};
  for (const id of Object.keys(before)) {
    const after = next.widgets[id];
    if (after === undefined || after.widget !== before[id].widget) {
      removals.push({ op: "unmount", id });
    }
  }
  for (const [id, widget] of Object.entries(next.widgets)) {
    const old = before[id];
    const mounted = old !== undefined && old.widget === widget.widget;
    if (!mounted) {
      mounts.push({ op: "mount", id, widget: widget.widget, box: widget.box, z: widget.z, visible: widget.visible });
    } else {
      if (!sameBox(old.box, widget.box)) {
        writes.push({ op: "setBox", id, box: widget.box });
      }
      if (old.z !== widget.z) {
        writes.push({ op: "setStack", id, z: widget.z });
      }
      if (old.visible !== widget.visible) {
        writes.push({ op: "setVisible", id, visible: widget.visible });
      }
    }
    diffAnimations(id, mounted ? old.animations : EMPTY_LAYERS, widget.animations, cancels, starts);
    diffDelegates(id, mounted ? old : null, widget, delegates);
  }
  diffAnimations(null, prev?.canvas.animations ?? EMPTY_LAYERS, next.canvas.animations, cancels, starts);
  return [...removals, ...mounts, ...writes, ...cancels, ...starts, ...delegates];
}
function diffAnimations(id, prev, next, cancels, starts) {
  for (const layer of LAYERS) {
    const old = prev[layer];
    const now = next[layer];
    let kept = 0;
    while (kept < old.length && kept < now.length && sameAnimation(old[kept], now[kept])) {
      kept += 1;
    }
    for (const animation2 of old.slice(kept)) {
      cancels.push({ op: "cancelAnimation", id, layer, behavior: animation2.behavior });
    }
    for (const animation2 of now.slice(kept)) {
      starts.push({ op: "startAnimation", id, layer, behavior: animation2.behavior, spec: animation2.spec });
    }
  }
}
function diffDelegates(id, prev, next, out) {
  const old = new Map((prev?.delegated ?? []).map((entry) => [entry.behavior, entry]));
  const current = new Set(next.delegated.map((entry) => entry.behavior));
  for (const behavior of old.keys()) {
    if (!current.has(behavior)) {
      out.push({ op: "cancelDelegate", id, behavior });
    }
  }
  for (const entry of next.delegated) {
    const previous = old.get(entry.behavior);
    if (previous === undefined || !sameValue2(previous, entry)) {
      out.push({ op: "delegate", id, delegated: entry });
    }
  }
}
function sameBox(a, b) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.rotation === b.rotation && a.opacity === b.opacity;
}
function sameAnimation(a, b) {
  return a.behavior === b.behavior && sameValue2(a.spec, b.spec);
}
function sameValue2(a, b) {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  const bRecord = b;
  const aRecord = a;
  return aKeys.every((key) => Object.hasOwn(bRecord, key) && sameValue2(aRecord[key], bRecord[key]));
}
// ../shared/clients/typescript/scene/runtime/dom.ts
function createDomRenderer(options) {
  const doc = options.document;
  const widgets = new Map;
  let playing = true;
  let origin = timelineNow() - (options.atMs ?? 0);
  let pausedAtMs = 0;
  const canvasTransition = fill(doc.createElement("div"));
  const canvasEffect = fill(doc.createElement("div"));
  const layer = fill(doc.createElement("div"));
  canvasTransition.setAttribute("data-scene-layer", "canvas-transition");
  canvasEffect.setAttribute("data-scene-layer", "canvas-effect");
  layer.setAttribute("data-scene-layer", "widgets");
  canvasEffect.appendChild(layer);
  canvasTransition.appendChild(canvasEffect);
  options.root.appendChild(canvasTransition);
  const canvas = { transition: canvasTransition, effect: canvasEffect, animations: new Map };
  function timelineNow() {
    const now = doc.timeline.currentTime;
    if (typeof now !== "number") {
      throw new Error("runtime: the document timeline is not running");
    }
    return now;
  }
  function* allAnimations() {
    yield* canvas.animations.values();
    for (const widget of widgets.values()) {
      yield* widget.animations.values();
    }
  }
  function wrappersOf(id) {
    if (id === null) {
      return canvas;
    }
    return mustGet(id);
  }
  function mustGet(id) {
    const widget = widgets.get(id);
    if (widget === undefined) {
      throw new Error(`runtime: widget ${id} is not mounted`);
    }
    return widget;
  }
  function writeStyle(widget, property, value) {
    if (widget.written[property] === value) {
      return;
    }
    widget.written[property] = value;
    widget.box.style[property] = value;
  }
  function writeBox(widget, box) {
    writeStyle(widget, "transform", `translate(${box.x}px, ${box.y}px) rotate(${box.rotation}deg)`);
    writeStyle(widget, "width", `${box.width}px`);
    writeStyle(widget, "height", `${box.height}px`);
    writeStyle(widget, "opacity", String(box.opacity));
  }
  function mount(op) {
    if (widgets.has(op.id)) {
      throw new Error(`runtime: widget ${op.id} is already mounted`);
    }
    const box = doc.createElement("div");
    box.setAttribute("data-scene-widget", op.id);
    box.style.position = "absolute";
    box.style.left = "0";
    box.style.top = "0";
    box.style.transformOrigin = "50% 50%";
    const transition = fill(doc.createElement("div"));
    const effect = fill(doc.createElement("div"));
    const slot = fill(doc.createElement("div"));
    effect.appendChild(slot);
    transition.appendChild(effect);
    box.appendChild(transition);
    const widget = {
      box,
      transition,
      effect,
      animations: new Map,
      unmountContent: () => {},
      written: {}
    };
    writeBox(widget, op.box);
    writeStyle(widget, "zIndex", String(op.z));
    writeStyle(widget, "visibility", op.visible ? "" : "hidden");
    layer.appendChild(box);
    widgets.set(op.id, widget);
    widget.unmountContent = options.mountContent(slot, op.id, op.widget);
  }
  function unmount(id) {
    const widget = mustGet(id);
    for (const animation2 of widget.animations.values()) {
      animation2.cancel();
    }
    widget.animations.clear();
    widgets.delete(id);
    widget.unmountContent();
    widget.box.remove();
  }
  function startAnimation(op) {
    const wrappers = wrappersOf(op.id);
    const key = `${op.layer}:${op.behavior}`;
    if (wrappers.animations.has(key)) {
      throw new Error(`runtime: behavior ${op.behavior} is already animating; cancel it first`);
    }
    const animation2 = wrappers[op.layer].animate(domKeyframes(op.spec.keyframes), { ...op.spec.timing });
    if (playing) {
      animation2.startTime = origin;
    } else {
      animation2.pause();
      animation2.currentTime = pausedAtMs;
    }
    wrappers.animations.set(key, animation2);
  }
  function cancelAnimation(op) {
    const wrappers = wrappersOf(op.id);
    const key = `${op.layer}:${op.behavior}`;
    const animation2 = wrappers.animations.get(key);
    if (animation2 === undefined) {
      throw new Error(`runtime: no animation for behavior ${op.behavior} to cancel`);
    }
    animation2.cancel();
    wrappers.animations.delete(key);
  }
  return {
    apply(ops) {
      for (const op of ops) {
        switch (op.op) {
          case "unmount":
            unmount(op.id);
            break;
          case "mount":
            mount(op);
            break;
          case "setBox":
            writeBox(mustGet(op.id), op.box);
            break;
          case "setStack":
            writeStyle(mustGet(op.id), "zIndex", String(op.z));
            break;
          case "setVisible":
            writeStyle(mustGet(op.id), "visibility", op.visible ? "" : "hidden");
            break;
          case "startAnimation":
            startAnimation(op);
            break;
          case "cancelAnimation":
            cancelAnimation(op);
            break;
          case "delegate":
            mustGet(op.id);
            options.onDelegate?.(op.id, { kind: "start", delegated: op.delegated });
            break;
          case "cancelDelegate":
            mustGet(op.id);
            options.onDelegate?.(op.id, { kind: "cancel", behavior: op.behavior });
            break;
          default:
            throw new Error(`runtime: unknown patch op ${JSON.stringify(op)}`);
        }
      }
    },
    seek(ms) {
      if (!Number.isFinite(ms)) {
        throw new Error("runtime: seek needs a finite time");
      }
      if (playing) {
        origin = timelineNow() - ms;
      } else {
        pausedAtMs = ms;
      }
      for (const animation2 of allAnimations()) {
        animation2.currentTime = ms;
      }
    },
    pause() {
      if (!playing) {
        return;
      }
      pausedAtMs = timelineNow() - origin;
      playing = false;
      for (const animation2 of allAnimations()) {
        animation2.pause();
        animation2.currentTime = pausedAtMs;
      }
    },
    play() {
      if (playing) {
        return;
      }
      origin = timelineNow() - pausedAtMs;
      playing = true;
      for (const animation2 of allAnimations()) {
        animation2.startTime = origin;
      }
    },
    timeMs() {
      return playing ? timelineNow() - origin : pausedAtMs;
    },
    boxOf(widgetId) {
      return widgets.get(widgetId)?.box;
    },
    dispose() {
      for (const id of [...widgets.keys()]) {
        unmount(id);
      }
      for (const animation2 of canvas.animations.values()) {
        animation2.cancel();
      }
      canvas.animations.clear();
      canvasTransition.remove();
    }
  };
}
function domKeyframes(frames) {
  return frames.map((frame) => ({ ...frame }));
}
function fill(element) {
  element.style.position = "absolute";
  element.style.left = "0";
  element.style.top = "0";
  element.style.width = "100%";
  element.style.height = "100%";
  return element;
}
// ../shared/clients/typescript/scene/runtime/plan.ts
var RENDERED_TYPES = ["transition", "effect"];
function planFrame(doc, options = {}) {
  const { timeline: timeline2, meta, transient } = options;
  if (timeline2 !== undefined && !(typeof options.atMs === "number" && Number.isFinite(options.atMs))) {
    throw new Error("plan: atMs must be a finite number when a timeline is given");
  }
  const atMs = timeline2 === undefined ? null : options.atMs;
  const ids = Object.keys(doc.widgets).filter((id) => (meta === undefined || Object.hasOwn(meta, id)) && timeline2?.widgets[id]?.status !== "never");
  const zOf = (id) => transient?.[id]?.z ?? doc.widgets[id].z;
  ids.sort((a, b) => compareText2(zOf(a), zOf(b)) || compareText2(a, b));
  const widgets = {};
  const changes = [];
  ids.forEach((id, rank) => {
    const placement = { ...doc.widgets[id], ...transient?.[id] };
    widgets[id] = {
      id,
      widget: placement.widget,
      box: {
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
        rotation: placement.rotation,
        opacity: placement.opacity
      },
      z: rank,
      visible: timeline2 === undefined ? placement.visible : shownAt(timeline2, id, atMs, changes),
      animations: { transition: [], effect: [] },
      delegated: []
    };
  });
  const canvas = { animations: { transition: [], effect: [] } };
  const skipped = [];
  if (timeline2 !== undefined) {
    for (const [behaviorId, behavior] of sortedBehaviors(doc)) {
      planBehavior(behaviorId, behavior, {
        timeline: timeline2,
        atMs,
        doc,
        widgets,
        canvas,
        skipped,
        changes,
        declaredKinds: options.declaredKinds
      });
    }
  }
  const future = changes.filter((time) => time > atMs);
  return {
    atMs,
    widgets,
    canvas,
    nextChangeMs: future.length === 0 ? null : Math.min(...future),
    skipped
  };
}
function shownAt(timeline2, id, atMs, changes) {
  const resolved = timeline2.widgets[id];
  if (resolved === undefined) {
    throw new Error(`plan: the timeline has no entry for widget ${id}; resolve it for this document`);
  }
  const { enterMs, exitMs } = resolved;
  if (enterMs !== null) {
    changes.push(enterMs);
  }
  if (exitMs !== null) {
    changes.push(exitMs);
  }
  return enterMs !== null && enterMs <= atMs && (exitMs === null || atMs < exitMs);
}
function planBehavior(id, behavior, planning) {
  const { timeline: timeline2, atMs, doc, widgets, canvas, skipped, changes, declaredKinds } = planning;
  if (behavior.type === "activity") {
    return;
  }
  if (!RENDERED_TYPES.includes(behavior.type)) {
    skipped.push({ behavior: id, reason: "unknown-type" });
    return;
  }
  const onCanvas = behavior.target === CANVAS_TARGET;
  if (!onCanvas && !Object.hasOwn(doc.widgets, behavior.target)) {
    skipped.push({ behavior: id, reason: "dangling-target" });
    return;
  }
  const target = onCanvas ? canvas : widgets[behavior.target];
  if (target === undefined) {
    return;
  }
  const window2 = timeline2.behaviors[id];
  if (window2 === undefined || window2.startMs === null) {
    return;
  }
  if (!isHostKind(behavior.type, behavior.kind)) {
    if (onCanvas) {
      skipped.push({ behavior: id, reason: "canvas-delegate" });
      return;
    }
    if (declaredKinds !== undefined && !declaresKind(declaredKinds(behavior.target) ?? NO_DECLARED_KINDS, behavior.type, behavior.kind)) {
      skipped.push({ behavior: id, reason: "undeclared-kind" });
      return;
    }
    changes.push(window2.startMs);
    if (window2.startMs <= atMs) {
      target.delegated.push({
        behavior: id,
        type: behavior.type,
        kind: behavior.kind,
        phase: phaseOf2(behavior),
        startMs: window2.startMs,
        endMs: window2.endMs,
        easing: behavior.timing.easing,
        params: behavior.params
      });
    }
    return;
  }
  if (behavior.type === "transition" && window2.endMs === null) {
    return;
  }
  let spec;
  try {
    spec = compileAnimation(behavior, { startMs: window2.startMs, endMs: window2.endMs });
  } catch {
    skipped.push({ behavior: id, reason: "invalid-params" });
    return;
  }
  if (spec === null) {
    throw new Error(`plan: host kind ${behavior.type}/${behavior.kind} compiled to nothing`);
  }
  target.animations[spec.layer].push({ behavior: id, spec });
}
function sortedBehaviors(doc) {
  return Object.entries(doc.behaviors).sort(([aId, a], [bId, b]) => compareText2(a.order, b.order) || compareText2(aId, bId));
}
function phaseOf2(behavior) {
  if (behavior.type !== "transition") {
    return null;
  }
  const phase = behavior.params.phase;
  return phase === "in" || phase === "out" ? phase : null;
}
function compareText2(a, b) {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
function fitCanvas(canvas, area) {
  if (!(canvas.width > 0 && canvas.height > 0)) {
    throw new Error("plan: a canvas must have a positive width and height");
  }
  const scale = Math.min(area.width / canvas.width, area.height / canvas.height);
  return {
    scale,
    x: (area.width - canvas.width * scale) / 2,
    y: (area.height - canvas.height * scale) / 2
  };
}
// ../shared/clients/typescript/scene/runtime/preview-protocol.ts
var PROBLEM_KINDS = new Set([
  "invalid-message",
  "invalid-entry",
  "bind",
  "unknown-widget",
  "unframed-widget",
  "frames-unavailable",
  "timeline",
  "plan"
]);
// ../shared/clients/typescript/scene/runtime/scheduler.ts
function createScheduler(options) {
  const { profile, clock, renderer } = options;
  const startedAtMs = clock.now();
  let doc = options.doc;
  let meta = options.meta;
  let transient;
  const observed = new Map;
  const initialVisible = new Map;
  const currentVisible = new Map;
  let lastTimeline = null;
  let lastPlan = null;
  const reportedSkips = new Set;
  let timer = null;
  let finished = false;
  let disposed = false;
  for (const [id, placement] of Object.entries(doc.widgets)) {
    initialVisible.set(id, placement.visible);
    currentVisible.set(id, placement.visible);
  }
  function factsOf(id) {
    let facts = observed.get(id);
    if (facts === undefined) {
      facts = { visibility: [] };
      observed.set(id, facts);
    }
    return facts;
  }
  function recordVisibility(id, visible, atMs) {
    if (currentVisible.get(id) === visible) {
      return;
    }
    currentVisible.set(id, visible);
    factsOf(id).visibility.push({ atMs, visible });
  }
  function replaceFromNow(next) {
    const now = clock.now();
    for (const id of Object.keys(doc.widgets)) {
      if (!Object.hasOwn(next.widgets, id)) {
        observed.delete(id);
        initialVisible.delete(id);
        currentVisible.delete(id);
      }
    }
    for (const [id, placement] of Object.entries(next.widgets)) {
      if (!initialVisible.has(id)) {
        initialVisible.set(id, false);
        currentVisible.set(id, false);
      }
      recordVisibility(id, placement.visible, now);
    }
  }
  function replaceFromStart(next) {
    for (const [id, before] of Object.entries(doc.widgets)) {
      const after = next.widgets[id];
      const facts = observed.get(id);
      if (after === undefined || after.widget !== before.widget || !sameJson(after.settings, before.settings)) {
        observed.delete(id);
      } else if (facts !== undefined) {
        facts.visibility = [];
      }
    }
    initialVisible.clear();
    currentVisible.clear();
    for (const [id, placement] of Object.entries(next.widgets)) {
      initialVisible.set(id, placement.visible);
      currentVisible.set(id, placement.visible);
    }
  }
  function resolverDocument() {
    const widgets = {};
    for (const [id, placement] of Object.entries(doc.widgets)) {
      const visible = initialVisible.get(id);
      if (visible === undefined) {
        throw new Error(`runtime: widget ${id} has no starting visibility`);
      }
      widgets[id] = visible === placement.visible ? placement : { ...placement, visible };
    }
    return { ...doc, widgets };
  }
  function update() {
    if (disposed) {
      return;
    }
    const now = clock.now();
    const facts = { startedAtMs, nowMs: now, widgets: Object.fromEntries(observed) };
    const timeline2 = resolveTimeline(resolverDocument(), profile, facts, options.estimate === undefined ? {} : { estimate: options.estimate });
    const atMs = now - startedAtMs;
    const plan = planFrame(doc, { timeline: timeline2, atMs, meta, transient, declaredKinds: options.declaredKinds });
    const ops = diffPlans(lastPlan, plan);
    lastTimeline = timeline2;
    lastPlan = plan;
    if (ops.length > 0) {
      renderer.apply(ops);
    }
    reportSkips(plan.skipped);
    schedule(timeline2, plan, atMs);
  }
  function reportSkips(skips) {
    if (options.onSkipped === undefined) {
      return;
    }
    const fresh = skips.filter((skip) => !reportedSkips.has(`${skip.behavior}\x00${skip.reason}`));
    if (fresh.length === 0) {
      return;
    }
    for (const skip of fresh) {
      reportedSkips.add(`${skip.behavior}\x00${skip.reason}`);
    }
    options.onSkipped(fresh);
  }
  function schedule(timeline2, plan, atMs) {
    if (timer !== null) {
      clock.clearTimer(timer.handle);
      timer = null;
    }
    const finishMs = profile.bounded && !finished ? timeline2.finishMs : null;
    if (finishMs !== null && finishMs <= atMs) {
      finished = true;
      options.onFinished?.();
      return;
    }
    const due = [timeline2.revisitAtMs, plan.nextChangeMs, finishMs].filter((time) => time !== null && time > atMs);
    if (due.length === 0 || finished) {
      return;
    }
    timer = { handle: clock.setTimer(startedAtMs + Math.min(...due), onTimer) };
  }
  function onTimer() {
    timer = null;
    update();
  }
  function accepts(id) {
    return !disposed && Object.hasOwn(doc.widgets, id);
  }
  update();
  return {
    widgetSubscribed(id, timed) {
      if (!accepts(id)) {
        return;
      }
      const facts = factsOf(id);
      if (facts.subscribedAtMs !== undefined) {
        return;
      }
      facts.subscribedAtMs = clock.now();
      facts.timed = timed;
      update();
    },
    widgetRendered(id) {
      if (!accepts(id)) {
        return;
      }
      const facts = factsOf(id);
      if (facts.renderedAtMs !== undefined) {
        return;
      }
      facts.renderedAtMs = clock.now();
      update();
    },
    widgetCompleted(id) {
      if (!accepts(id)) {
        return;
      }
      const facts = factsOf(id);
      if (facts.completedAtMs !== undefined) {
        return;
      }
      facts.completedAtMs = clock.now();
      update();
    },
    visibilityChanged(id, visible) {
      if (!accepts(id)) {
        return;
      }
      recordVisibility(id, visible, clock.now());
      update();
    },
    setDocument(next, nextMeta) {
      if (disposed) {
        throw new Error("runtime: setDocument after the scheduler was disposed");
      }
      if (options.documentChanges === "start") {
        replaceFromStart(next);
      } else {
        replaceFromNow(next);
      }
      doc = next;
      if (nextMeta !== undefined) {
        meta = nextMeta;
      }
      update();
    },
    setTransient(next) {
      transient = next;
      update();
    },
    timeline() {
      if (lastTimeline === null) {
        throw new Error("runtime: the scheduler has not resolved yet");
      }
      return lastTimeline;
    },
    plan() {
      if (lastPlan === null) {
        throw new Error("runtime: the scheduler has not planned yet");
      }
      return lastPlan;
    },
    elapsedMs() {
      return clock.now() - startedAtMs;
    },
    resync() {
      if (disposed) {
        throw new Error("runtime: resync after the scheduler was disposed");
      }
      const finishMs = lastTimeline?.finishMs ?? null;
      if (finished && finishMs !== null && clock.now() - startedAtMs < finishMs) {
        finished = false;
      }
      update();
    },
    dispose() {
      disposed = true;
      if (timer !== null) {
        clock.clearTimer(timer.handle);
        timer = null;
      }
    }
  };
}
function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
// public/scene-manager/page-clock.ts
var PAGE_CLOCK = {
  now: () => performance.now(),
  setTimer: (atMs, callback) => setTimeout(callback, Math.max(0, atMs - performance.now())),
  clearTimer: (handle) => clearTimeout(handle)
};

// public/scene-manager/scene-update.ts
function planSceneUpdate(current, next) {
  const currentById = new Map(current.map((placement) => [placement.id, placement]));
  const nextIds = new Set(next.map((placement) => placement.id));
  const plan2 = {
    remove: current.filter((placement) => !nextIds.has(placement.id)).map((placement) => placement.id),
    mount: [],
    replace: [],
    place: [],
    order: next.map((placement) => placement.id)
  };
  for (const placement of next) {
    const existing = currentById.get(placement.id);
    if (!existing) {
      plan2.mount.push(placement);
    } else if (sameFrame(existing, placement)) {
      plan2.place.push(placement);
    } else {
      plan2.replace.push(placement);
    }
  }
  return plan2;
}
function sameFrame(a, b) {
  return a.widgetCanonicalId === b.widgetCanonicalId && a.moduleId === b.moduleId && a.hostsSurface === b.hostsSurface && a.frameUrl === b.frameUrl && (a.hostsSurface === "" || sameValue3(a.settings, b.settings));
}
function settingsUpdate(current, next, reads) {
  const keys2 = new Set([...Object.keys(current), ...Object.keys(next)]);
  const changed = [...keys2].filter((key) => !sameValue3(current[key], next[key]));
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
function sameValue3(a, b) {
  if (a === b) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue3(item, b[i]));
  }
  const aRecord = a;
  const bRecord = b;
  const aKeys = Object.keys(aRecord);
  if (aKeys.length !== Object.keys(bRecord).length) {
    return false;
  }
  return aKeys.every((key) => Object.hasOwn(bRecord, key) && sameValue3(aRecord[key], bRecord[key]));
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

// public/scene-manager/widget-behaviors.ts
function behaviorStateOf(delegated) {
  const durationMs = delegated.endMs === null ? null : Math.max(0, delegated.endMs - delegated.startMs);
  if (delegated.type === "transition") {
    if (delegated.phase === null) {
      return null;
    }
    return {
      type: "transition",
      kind: delegated.kind,
      phase: delegated.phase,
      durationMs,
      easing: delegated.easing,
      params: delegated.params
    };
  }
  if (delegated.type === "effect") {
    return { type: "effect", kind: delegated.kind, durationMs, easing: delegated.easing, params: delegated.params };
  }
  return null;
}
function entranceOf(doc, widgetId, declares) {
  const entrances = Object.entries(doc.behaviors).filter(([, behavior2]) => behavior2.type === "transition" && behavior2.target === widgetId && behavior2.params.phase === "in" && !isHostKind(behavior2.type, behavior2.kind) && declares(behavior2.type, behavior2.kind)).sort(([aId, a], [bId, b]) => compareText3(a.order, b.order) || compareText3(aId, bId));
  const first = entrances[0];
  if (first === undefined) {
    return null;
  }
  const [, behavior] = first;
  return {
    type: "transition",
    kind: behavior.kind,
    phase: "in",
    durationMs: typeof behavior.timing.durationMs === "number" ? behavior.timing.durationMs : null,
    easing: behavior.timing.easing,
    params: behavior.params
  };
}

class BehaviorRelay {
  send;
  playing = new Map;
  constructor(send) {
    this.send = send;
  }
  handle(widgetId, request) {
    if (request.kind === "start") {
      this.start(widgetId, request.delegated);
    } else {
      this.cancel(widgetId, request.behavior);
    }
  }
  forget(widgetId) {
    this.playing.delete(widgetId);
  }
  ongoing(widgetId) {
    return [...this.playing.get(widgetId)?.values() ?? []].filter(({ state }) => state.type === "effect" && state.durationMs === null).map(({ state }) => state);
  }
  start(widgetId, delegated) {
    const state = behaviorStateOf(delegated);
    if (state === null) {
      console.warn("[scene-manager] a widget behavior the protocol cannot carry; skipped", {
        widgetId,
        behavior: delegated.behavior
      });
      return;
    }
    let widget = this.playing.get(widgetId);
    if (widget === undefined) {
      widget = new Map;
      this.playing.set(widgetId, widget);
    }
    const previous = widget.get(delegated.behavior);
    widget.set(delegated.behavior, { state, startMs: delegated.startMs });
    if (previous !== undefined && previous.startMs === delegated.startMs && sameExceptDuration(previous.state, state)) {
      return;
    }
    this.send(widgetId, state);
  }
  cancel(widgetId, behavior) {
    const widget = this.playing.get(widgetId);
    if (widget === undefined || !widget.delete(behavior)) {
      return;
    }
    this.send(widgetId, null);
    for (const type of ["transition", "effect"]) {
      const latest = [...widget.values()].filter(({ state }) => state.type === type).sort((a, b) => b.startMs - a.startMs)[0];
      if (latest !== undefined) {
        this.send(widgetId, latest.state);
      }
    }
  }
}
function sameExceptDuration(a, b) {
  return a.type === b.type && a.kind === b.kind && a.phase === b.phase && a.easing === b.easing && sameValue3(a.params, b.params);
}
function compareText3(a, b) {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
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
  sendBehavior(behavior) {
    this.post({ type: "behavior", behavior });
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
function playAlert(options) {
  const { doc } = options;
  const frames = new Map;
  const subscribed = new Set;
  const relay = new BehaviorRelay((widgetId, state) => frames.get(widgetId)?.sendBehavior(state));
  let scheduler2 = null;
  let stopped = false;
  function record(fact) {
    if (stopped) {
      return;
    }
    if (scheduler2 === null) {
      throw new Error("alert: a frame reported before the alert started playing");
    }
    fact(scheduler2);
  }
  const renderer = createDomRenderer({
    document: options.document,
    root: options.stage,
    mountContent: (slot, widgetId) => {
      const frame = options.mountFrame(slot, widgetId, entranceOf(doc, widgetId, () => true), {
        subscribed: (timed) => {
          subscribed.add(widgetId);
          record((playing) => playing.widgetSubscribed(widgetId, timed));
        },
        rendered: () => record((playing) => playing.widgetRendered(widgetId)),
        completed: () => {
          if (subscribed.has(widgetId)) {
            record((playing) => playing.widgetCompleted(widgetId));
          }
        }
      });
      frames.set(widgetId, frame);
      return () => {
        frames.delete(widgetId);
        relay.forget(widgetId);
        frame.unmount();
      };
    },
    onDelegate: (widgetId, request) => relay.handle(widgetId, request)
  });
  function stop() {
    if (stopped) {
      return;
    }
    stopped = true;
    scheduler2?.dispose();
    renderer.dispose();
  }
  scheduler2 = createScheduler({
    doc,
    profile: PROFILES.alert,
    clock: options.clock,
    renderer,
    onFinished: () => {
      stop();
      options.onFinished();
    }
  });
  return { stop };
}

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
    const { element } = this.opts;
    const canvas = canvasOf(delivery.layout);
    const stage = document.createElement("div");
    stage.className = "alert-stage";
    stage.style.width = `${canvas.width}px`;
    stage.style.height = `${canvas.height}px`;
    const fit = fitCanvas(canvas, { width: element.clientWidth, height: element.clientHeight });
    stage.style.transform = `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`;
    element.appendChild(stage);
    const alertEvent = {
      type: "alert",
      source: "scene-manager",
      time: new Date().toISOString(),
      data: delivery.event,
      eventId
    };
    let player = null;
    const tearDown = () => {
      this.playing.delete(eventId);
      player?.stop();
      stage.remove();
    };
    this.playing.set(eventId, tearDown);
    player = playAlert({
      document,
      stage,
      doc: delivery.layout,
      clock: PAGE_CLOCK,
      mountFrame: (slot, widgetId, entrance, facts) => this.mountFrame(eventId, alertEvent, slot, widgetId, entrance, facts),
      onFinished: () => {
        tearDown();
        this.opts.onFinished(eventId);
      }
    });
  }
  mountFrame(eventId, alertEvent, slot, widgetId, entrance, facts) {
    const { sceneBase, bridges } = this.opts;
    const instanceId = `${eventId}.${widgetId}`;
    const nonce = this.opts.generateNonce();
    const iframe = document.createElement("iframe");
    iframe.className = "widget-frame";
    iframe.setAttribute("sandbox", "allow-scripts");
    const bridge = new WidgetBridge(instanceId, nonce, {
      onStorageGet: () => null,
      onStorageSubscribe: () => {},
      onStorageUnsubscribe: () => {},
      onStatusReport: (report) => this.opts.postStatus(instanceId, report),
      onEventsSubscribe: (subId, queue) => {
        facts.subscribed(queue?.autoComplete === false);
        bridge.sendEvent(subId, alertEvent);
      },
      onEventsUnsubscribe: () => {},
      onEventComplete: () => facts.completed(),
      onDispose: () => {},
      onRendered: () => facts.rendered()
    });
    iframe.addEventListener("load", createFrameLoadHandler(bridge));
    const fragment = entrance === null ? "" : `#${encodePlacementBoot({ behavior: entrance })}`;
    iframe.src = `${sceneBase}/alert/${encodeURIComponent(eventId)}/widget/${encodeURIComponent(widgetId)}` + `?nonce=${encodeURIComponent(nonce)}${fragment}`;
    bridges.add(bridge);
    slot.appendChild(iframe);
    bridge.attach(iframe);
    return {
      sendBehavior: (state) => bridge.sendBehavior(state),
      unmount: () => {
        bridge.dispose();
        bridge.detach();
        bridges.delete(bridge);
        iframe.remove();
      }
    };
  }
}
function canvasOf(doc) {
  return { width: doc.layout.width, height: doc.layout.height };
}
function parseDelivery(value) {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { layout, event } = value;
  const doc = alertCompositionOf(layout);
  if (doc === null || !isPositive(doc.layout.width) || !isPositive(doc.layout.height)) {
    return null;
  }
  return { layout: doc, event: event ?? null };
}
function isPositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
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

// ../shared/clients/typescript/api/scene-editor/document.ts
var import_ot_json0 = __toESM(require_lib(), 1);
var json0 = import_ot_json0.default.type;
function isVersion(value) {
  return value === "draft" || value === "published";
}
var MAX_OPS_BYTES = 64 * 1024;
var MAX_DOCUMENT_BYTES = 1024 * 1024;
var MAX_ITEM_BYTES = 3 * MAX_DOCUMENT_BYTES;
function applyOps(doc, ops) {
  return json0.apply(structuredClone(doc), structuredClone([...ops]));
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
  const doc = normalizeComposition(value.doc);
  if (typeof value.sceneId !== "string" || typeof value.seq !== "number" || doc === null || !isPlainObject(value.meta)) {
    return null;
  }
  return { ...value, doc };
}
function parseSceneOpsEvent(value) {
  if (!isPlainObject(value)) {
    return null;
  }
  if (typeof value.seq !== "number" || !Array.isArray(value.ops) || !isPlainObject(value.meta)) {
    return null;
  }
  if (value.version !== undefined && !isVersion(value.version)) {
    return null;
  }
  return value;
}
var COMPONENT_KEYS = new Set(["p", "oi", "od", "si", "sd"]);

// public/scene-manager/scene-document.ts
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
      ...meta.mediaProxyBase === undefined ? {} : { mediaProxyBase: meta.mediaProxyBase },
      ...meta.behaviorKinds === undefined ? {} : { behaviorKinds: meta.behaviorKinds },
      visible: placement.visible
    });
  }
  return { id: snapshot.sceneId, name: snapshot.name, layout: snapshot.doc.layout, widgets };
}
function compositionOfConfig(config, base, drafts = null) {
  const draftById = new Map;
  for (const raw of drafts ?? []) {
    if (typeof raw === "object" && raw !== null && typeof raw.id === "string") {
      draftById.set(raw.id, raw);
    }
  }
  const zKeys = evenKeys(config.widgets.length);
  const widgets = {};
  config.widgets.forEach((instance, index) => {
    const saved = base && Object.hasOwn(base.widgets, instance.id) ? base.widgets[instance.id] : undefined;
    const draft = draftById.get(instance.id);
    widgets[instance.id] = {
      name: saved?.name ?? "",
      locked: saved?.locked ?? false,
      extra: saved?.extra ?? {},
      widget: instance.widgetCanonicalId,
      x: instance.position.x,
      y: instance.position.y,
      width: instance.position.width,
      height: instance.position.height,
      visible: instance.visible !== false,
      z: zKeys[index],
      settings: instance.settings,
      rotation: finiteOr(draft?.rotation, saved?.rotation ?? 0),
      opacity: opacityOr(draft?.opacity, saved?.opacity ?? 1)
    };
  });
  return { layout: config.layout, widgets, behaviors: base?.behaviors ?? {} };
}
function finiteOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function opacityOr(value, fallback) {
  return typeof value === "number" && value >= 0 && value <= 1 ? value : fallback;
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
function isFiniteNumber3(value) {
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
  if (!isFiniteNumber3(w.x) || !isFiniteNumber3(w.y) || !isFiniteNumber3(w.width) || !isFiniteNumber3(w.height)) {
    return null;
  }
  const widget = { id: w.id, x: w.x, y: w.y, width: w.width, height: w.height };
  if (isFiniteNumber3(w.rotation)) {
    widget.rotation = w.rotation;
  }
  if (isFiniteNumber3(w.opacity) && w.opacity >= 0 && w.opacity <= 1) {
    widget.opacity = w.opacity;
  }
  return widget;
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
function transientOfPreviewLayout(layout, ids) {
  const transient = {};
  const zKeys = evenKeys(layout.length);
  layout.forEach((widget, index) => {
    transient[widget.id] = {
      x: widget.x,
      y: widget.y,
      width: widget.width,
      height: widget.height,
      z: zKeys[index],
      ...widget.rotation === undefined ? {} : { rotation: widget.rotation },
      ...widget.opacity === undefined ? {} : { opacity: widget.opacity }
    };
  });
  for (const id of ids) {
    if (!Object.hasOwn(transient, id)) {
      transient[id] = { opacity: 0 };
    }
  }
  return transient;
}

// public/scene-manager/media-url.ts
var MAX_DEPTH = 32;
function isPlainObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isAbsoluteHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== "";
}
function externalMediaUrl(value) {
  if (!isPlainObject2(value) || value.source !== "url" || typeof value.url !== "string" || !isAbsoluteHttpUrl(value.url)) {
    return null;
  }
  return value.url;
}
function rewriteExternalMedia(value, replace) {
  return rewrite(value, replace, 0);
}
function rewrite(value, replace, depth) {
  if (depth > MAX_DEPTH || typeof value !== "object" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next2 = value.map((item) => {
      const rewritten = rewrite(item, replace, depth + 1);
      changed ||= rewritten !== item;
      return rewritten;
    });
    return changed ? next2 : value;
  }
  const record = value;
  const external = externalMediaUrl(record);
  if (external !== null) {
    const replaced = replace(external);
    return replaced === undefined || replaced === external ? record : { ...record, url: replaced };
  }
  let next = null;
  for (const [key, item] of Object.entries(record)) {
    const rewritten = rewrite(item, replace, depth + 1);
    if (rewritten !== item) {
      next ??= { ...record };
      next[key] = rewritten;
    }
  }
  return next ?? record;
}
function externalMediaUrls(value) {
  const urls = new Set;
  rewriteExternalMedia(value, (url) => {
    urls.add(url);
    return;
  });
  return [...urls];
}
var MEDIA_PROXY_TOKEN = /^[A-Za-z0-9_-]+\.(\d+)\.[0-9a-f]{64}$/;
function mediaProxyExpiry(url, base) {
  if (!url.startsWith(base)) {
    return null;
  }
  const match = MEDIA_PROXY_TOKEN.exec(url.slice(base.length));
  return match ? Number(match[1]) : null;
}
function earliestMediaProxyExpiry(value, base) {
  if (base === undefined) {
    return null;
  }
  let earliest = null;
  for (const url of externalMediaUrls(value)) {
    const expiry = mediaProxyExpiry(url, base);
    if (expiry !== null && (earliest === null || expiry < earliest)) {
      earliest = expiry;
    }
  }
  return earliest;
}
var MEDIA_REFRESH_MARGIN_MS = 6 * 60 * 60 * 1000;
var MIN_MEDIA_REFRESH_DELAY_MS = 60000;
var MAX_MEDIA_REFRESH_RETRY_MS = 30 * 60000;
var MAX_TIMER_DELAY_MS = 2147483647;
function mediaRefreshDelay(earliest, now, failures) {
  const untilExpiry = earliest * 1000 - now;
  if (failures === 0) {
    return Math.min(Math.max(untilExpiry - MEDIA_REFRESH_MARGIN_MS, MIN_MEDIA_REFRESH_DELAY_MS), MAX_TIMER_DELAY_MS);
  }
  const backoff = Math.min(MIN_MEDIA_REFRESH_DELAY_MS * 2 ** Math.min(failures - 1, 30), MAX_MEDIA_REFRESH_RETRY_MS);
  return Math.max(Math.min(backoff, untilExpiry), MIN_MEDIA_REFRESH_DELAY_MS);
}
function replaceMediaUrls(value, urls) {
  if (urls.size === 0) {
    return value;
  }
  return rewriteExternalMedia(value, (url) => urls.get(url));
}
function parseMediaUrls(value) {
  const placements = new Map;
  if (!isPlainObject2(value)) {
    return placements;
  }
  for (const [id, urls] of Object.entries(value)) {
    if (!isPlainObject2(urls)) {
      continue;
    }
    const signed = new Map;
    for (const [upstream, proxied] of Object.entries(urls)) {
      if (typeof proxied === "string") {
        signed.set(upstream, proxied);
      }
    }
    placements.set(id, signed);
  }
  return placements;
}

// public/scene-manager/frame-swap.ts
var SWAP_TIMEOUT_MS = 2000;
function swapFrameIn(args) {
  let settled = false;
  let cancelTimer = null;
  let fresh = null;
  const finish = () => {
    if (settled) {
      return;
    }
    if (fresh === null) {
      throw new Error("frame swap: the fresh frame reported painting before it was mounted");
    }
    settled = true;
    cancelTimer?.();
    fresh.reveal();
    args.retire();
    args.swapped(fresh);
  };
  fresh = args.mountFresh(finish);
  cancelTimer = args.schedule(finish, SWAP_TIMEOUT_MS);
  return {
    cancel: () => {
      if (settled) {
        return;
      }
      settled = true;
      cancelTimer?.();
      fresh?.unmount();
    }
  };
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
function generateNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function frameSrc(instance, nonce, entrance) {
  const boot = encodePlacementBoot({
    nonce,
    instanceId: instance.id,
    settings: instance.settings,
    linkedResources: instance.linkedResources ?? {},
    ...entrance === null ? {} : { behavior: entrance }
  });
  return `${instance.frameUrl}#${boot}`;
}
function asRecord(value) {
  return typeof value === "object" && value !== null ? value : {};
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
  let configs = new Map(sceneData.widgets.map((instance) => [instance.id, instance]));
  const contents = new Map;
  let composition2 = compositionOfConfig(sceneData, sceneDoc?.doc ?? null);
  let scheduler2 = null;
  function playing() {
    if (scheduler2 === null) {
      throw new Error("scene: the scene runtime is not running yet");
    }
    return scheduler2;
  }
  const relay = new BehaviorRelay((id, state) => contents.get(id)?.bridge?.sendBehavior(state));
  const mountAlertArea = (instance, slot) => {
    const element = document.createElement("div");
    element.className = "alert-widget";
    slot.appendChild(element);
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
    queueMicrotask(() => playing().widgetRendered(instance.id));
    return () => {
      alertWidget.dispose();
      queueManager.unregister(subId);
      element.remove();
    };
  };
  const mountFrame = (instance, slot, swapping, onRendered) => {
    const iframe = document.createElement("iframe");
    iframe.className = "widget-frame";
    if (swapping) {
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
        playing().widgetSubscribed(instance.id, queue?.autoComplete === false);
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
    const declared = instance.behaviorKinds ?? NO_DECLARED_KINDS;
    const entrance = swapping ? null : entranceOf(composition2, instance.id, (type, kind) => declaresKind(declared, type, kind));
    iframe.src = frameSrc(instance, nonce, entrance);
    bridges.add(bridge);
    slot.appendChild(iframe);
    bridge.attach(iframe);
    const unmount = () => {
      bridge.dispose();
      bridge.detach();
      bridges.delete(bridge);
      moduleState.unwatchAll(storageTarget);
      iframe.remove();
    };
    return { element: iframe, bridge, unmount };
  };
  function mountContent(slot, id) {
    const instance = configs.get(id);
    if (!instance) {
      throw new Error(`scene: placement ${id} is on the page with no config`);
    }
    if (instance.hostsSurface === "alert") {
      contents.set(id, { slot, unmount: mountAlertArea(instance, slot), bridge: null, swap: null });
    } else {
      const frame = mountFrame(instance, slot, false, () => playing().widgetRendered(id));
      contents.set(id, { slot, unmount: frame.unmount, bridge: frame.bridge, swap: null });
    }
  }
  function unmountContent(id) {
    const entry = contents.get(id);
    entry?.swap?.cancel();
    entry?.unmount();
    contents.delete(id);
  }
  const renderer = createDomRenderer({
    document,
    root: container,
    mountContent: (slot, id, widget) => {
      if (configs.get(id)?.widgetCanonicalId !== widget) {
        throw new Error(`scene: placement ${id} is mounted as ${widget}, which its config does not name`);
      }
      mountContent(slot, id);
      return () => {
        unmountContent(id);
        relay.forget(id);
      };
    },
    onDelegate: (id, request) => relay.handle(id, request)
  });
  scheduler2 = createScheduler({
    doc: composition2,
    profile: PROFILES.scene,
    clock: PAGE_CLOCK,
    renderer,
    declaredKinds: (id) => configs.get(id)?.behaviorKinds,
    onSkipped: (skips) => console.warn("[scene-manager] scene behaviors skipped", skips)
  });
  function swapFrame(next) {
    const entry = contents.get(next.id);
    if (!entry) {
      return;
    }
    if (next.hostsSurface !== "" || entry.bridge === null) {
      unmountContent(next.id);
      mountContent(entry.slot, next.id);
      return;
    }
    entry.swap?.cancel();
    entry.swap = swapFrameIn({
      mountFresh: (painted) => {
        const frame = mountFrame(next, entry.slot, true, painted);
        return {
          ...frame,
          reveal: () => {
            frame.element.style.opacity = "";
          }
        };
      },
      retire: () => entry.unmount(),
      swapped: (fresh) => {
        contents.set(next.id, { slot: entry.slot, unmount: fresh.unmount, bridge: fresh.bridge, swap: null });
        for (const state of relay.ongoing(next.id)) {
          fresh.bridge.sendBehavior(state);
        }
        playing().widgetRendered(next.id);
      },
      schedule: (callback, ms) => {
        const timer = setTimeout(callback, ms);
        return () => clearTimeout(timer);
      }
    });
  }
  function updateSettings(id, settings) {
    const config = configs.get(id);
    const entry = contents.get(id);
    if (!config || !entry) {
      return;
    }
    const reads = entry.swap || !entry.bridge ? null : entry.bridge.settingsReads();
    const decision = settingsUpdate(config.settings, settings, reads);
    if (decision === "none") {
      return;
    }
    configs.set(id, { ...config, settings });
    if (decision === "patch" && entry.bridge) {
      entry.bridge.sendSettings(settings);
      return;
    }
    swapFrame({ ...config, settings });
  }
  let mediaRefreshTimer = null;
  let mediaRefreshFailures = 0;
  function scheduleMediaRefresh() {
    if (mediaRefreshTimer !== null) {
      clearTimeout(mediaRefreshTimer);
      mediaRefreshTimer = null;
    }
    let earliest = null;
    for (const config of configs.values()) {
      const expiry = earliestMediaProxyExpiry(config.settings, config.mediaProxyBase);
      if (expiry !== null && (earliest === null || expiry < earliest)) {
        earliest = expiry;
      }
    }
    if (earliest === null) {
      return;
    }
    const delay = mediaRefreshDelay(earliest, Date.now(), mediaRefreshFailures);
    mediaRefreshTimer = setTimeout(() => {
      mediaRefreshTimer = null;
      updateScene();
    }, delay);
  }
  scheduleMediaRefresh();
  let previewLayout = null;
  let draftPlacements = null;
  let draftKey = "";
  let draftTimer = null;
  let proxiedMedia = new Map;
  const signedMediaOf = (placement) => typeof placement.id === "string" ? proxiedMedia.get(placement.id) : undefined;
  const draftSettingsOf = (placement) => {
    const signed = signedMediaOf(placement);
    const settings = settingsOf(placement);
    return signed ? replaceMediaUrls(settings, signed) : settings;
  };
  const draftKeyOf = (placements) => draftFrameKey(placements, (id) => configs.get(id)?.hostsSurface === "alert") + JSON.stringify(placements.flatMap((raw) => {
    const placement = asRecord(raw);
    const signed = signedMediaOf(placement);
    return externalMediaUrls(settingsOf(placement)).filter((url) => !signed?.has(url));
  }));
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
        playing().setTransient(transientOfPreviewLayout(layout, configs.keys()));
      }
      const placements = parsePreviewPlacements(event.data);
      if (placements) {
        draftPlacements = placements;
        for (const raw of placements) {
          const placement = asRecord(raw);
          const config = typeof placement.id === "string" ? configs.get(placement.id) : undefined;
          const settings = draftSettingsOf(placement);
          if (config && config.hostsSurface === "" && themeOf(config.settings) === themeOf(settings)) {
            updateSettings(config.id, settings);
          }
        }
        const key = draftKeyOf(placements);
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
      const latest = new Map(draftPlacements.map((raw) => [asRecord(raw).id, draftSettingsOf(asRecord(raw))]));
      for (const instance of next.widgets) {
        const settings = latest.get(instance.id);
        if (settings && instance.hostsSurface === "" && themeOf(settings) === themeOf(instance.settings)) {
          instance.settings = settings;
        }
      }
    }
    const previous = configs;
    const plan2 = planSceneUpdate([...previous.values()], next.widgets);
    const kept = new Set(plan2.place.map((instance) => instance.id));
    configs = new Map(next.widgets.map((instance) => {
      const old = previous.get(instance.id);
      return [instance.id, kept.has(instance.id) && old ? { ...instance, settings: old.settings } : instance];
    }));
    composition2 = compositionOfConfig(next, sceneDoc?.doc ?? null, fromDraft ? draftPlacements : null);
    playing().setDocument(composition2);
    for (const instance of plan2.replace) {
      if (previous.get(instance.id)?.widgetCanonicalId === instance.widgetCanonicalId) {
        swapFrame(instance);
      }
    }
    for (const instance of plan2.place) {
      updateSettings(instance.id, instance.settings);
    }
    if (previewLayout) {
      playing().setTransient(transientOfPreviewLayout(previewLayout, configs.keys()));
    }
    scheduleMediaRefresh();
    applySceneBackground(document.body, next.layout);
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
    if (draft && config) {
      proxiedMedia = parseMediaUrls(asRecord(body).mediaUrls);
      if (draftPlacements) {
        draftKey = draftKeyOf(draftPlacements);
      }
    }
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
          mediaRefreshFailures = 0;
          applySceneConfig(target.config, target.fromDraft);
        } else {
          mediaRefreshFailures += 1;
          scheduleMediaRefresh();
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
