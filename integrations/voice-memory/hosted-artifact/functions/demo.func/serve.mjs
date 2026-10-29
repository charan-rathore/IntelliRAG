// serve.mjs
import { Readable } from "node:stream";

// handler.mjs
import {
  createHash as createHash2,
  createHmac,
  timingSafeEqual,
  randomBytes as randomBytes2
} from "node:crypto";

// ../dist/engine.mjs
import { createHash, randomUUID } from "node:crypto";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var require_util = __commonJS({
  "node_modules/zod/v3/helpers/util.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getParsedType = exports.ZodParsedType = exports.objectUtil = exports.util = void 0;
    var util;
    (function(util2) {
      util2.assertEqual = (_) => {
      };
      function assertIs(_arg) {
      }
      util2.assertIs = assertIs;
      function assertNever(_x) {
        throw new Error();
      }
      util2.assertNever = assertNever;
      util2.arrayToEnum = (items) => {
        const obj = {};
        for (const item of items) {
          obj[item] = item;
        }
        return obj;
      };
      util2.getValidEnumValues = (obj) => {
        const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
        const filtered = {};
        for (const k of validKeys) {
          filtered[k] = obj[k];
        }
        return util2.objectValues(filtered);
      };
      util2.objectValues = (obj) => {
        return util2.objectKeys(obj).map(function(e) {
          return obj[e];
        });
      };
      util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
        const keys = [];
        for (const key in object) {
          if (Object.prototype.hasOwnProperty.call(object, key)) {
            keys.push(key);
          }
        }
        return keys;
      };
      util2.find = (arr, checker) => {
        for (const item of arr) {
          if (checker(item))
            return item;
        }
        return void 0;
      };
      util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
      function joinValues(array, separator = " | ") {
        return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
      }
      util2.joinValues = joinValues;
      util2.jsonStringifyReplacer = (_, value) => {
        if (typeof value === "bigint") {
          return value.toString();
        }
        return value;
      };
    })(util || (exports.util = util = {}));
    var objectUtil;
    (function(objectUtil2) {
      objectUtil2.mergeShapes = (first, second) => {
        return {
          ...first,
          ...second
          // second overwrites first
        };
      };
    })(objectUtil || (exports.objectUtil = objectUtil = {}));
    exports.ZodParsedType = util.arrayToEnum([
      "string",
      "nan",
      "number",
      "integer",
      "float",
      "boolean",
      "date",
      "bigint",
      "symbol",
      "function",
      "undefined",
      "null",
      "array",
      "object",
      "unknown",
      "promise",
      "void",
      "never",
      "map",
      "set"
    ]);
    var getParsedType = (data) => {
      const t = typeof data;
      switch (t) {
        case "undefined":
          return exports.ZodParsedType.undefined;
        case "string":
          return exports.ZodParsedType.string;
        case "number":
          return Number.isNaN(data) ? exports.ZodParsedType.nan : exports.ZodParsedType.number;
        case "boolean":
          return exports.ZodParsedType.boolean;
        case "function":
          return exports.ZodParsedType.function;
        case "bigint":
          return exports.ZodParsedType.bigint;
        case "symbol":
          return exports.ZodParsedType.symbol;
        case "object":
          if (Array.isArray(data)) {
            return exports.ZodParsedType.array;
          }
          if (data === null) {
            return exports.ZodParsedType.null;
          }
          if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
            return exports.ZodParsedType.promise;
          }
          if (typeof Map !== "undefined" && data instanceof Map) {
            return exports.ZodParsedType.map;
          }
          if (typeof Set !== "undefined" && data instanceof Set) {
            return exports.ZodParsedType.set;
          }
          if (typeof Date !== "undefined" && data instanceof Date) {
            return exports.ZodParsedType.date;
          }
          return exports.ZodParsedType.object;
        default:
          return exports.ZodParsedType.unknown;
      }
    };
    exports.getParsedType = getParsedType;
  }
});
var require_ZodError = __commonJS({
  "node_modules/zod/v3/ZodError.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ZodError = exports.quotelessJson = exports.ZodIssueCode = void 0;
    var util_js_1 = require_util();
    exports.ZodIssueCode = util_js_1.util.arrayToEnum([
      "invalid_type",
      "invalid_literal",
      "custom",
      "invalid_union",
      "invalid_union_discriminator",
      "invalid_enum_value",
      "unrecognized_keys",
      "invalid_arguments",
      "invalid_return_type",
      "invalid_date",
      "invalid_string",
      "too_small",
      "too_big",
      "invalid_intersection_types",
      "not_multiple_of",
      "not_finite"
    ]);
    var quotelessJson = (obj) => {
      const json = JSON.stringify(obj, null, 2);
      return json.replace(/"([^"]+)":/g, "$1:");
    };
    exports.quotelessJson = quotelessJson;
    var ZodError = class _ZodError extends Error {
      get errors() {
        return this.issues;
      }
      constructor(issues) {
        super();
        this.issues = [];
        this.addIssue = (sub) => {
          this.issues = [...this.issues, sub];
        };
        this.addIssues = (subs = []) => {
          this.issues = [...this.issues, ...subs];
        };
        const actualProto = new.target.prototype;
        if (Object.setPrototypeOf) {
          Object.setPrototypeOf(this, actualProto);
        } else {
          this.__proto__ = actualProto;
        }
        this.name = "ZodError";
        this.issues = issues;
      }
      format(_mapper) {
        const mapper = _mapper || function(issue) {
          return issue.message;
        };
        const fieldErrors = { _errors: [] };
        const processError = (error) => {
          for (const issue of error.issues) {
            if (issue.code === "invalid_union") {
              issue.unionErrors.map(processError);
            } else if (issue.code === "invalid_return_type") {
              processError(issue.returnTypeError);
            } else if (issue.code === "invalid_arguments") {
              processError(issue.argumentsError);
            } else if (issue.path.length === 0) {
              fieldErrors._errors.push(mapper(issue));
            } else {
              let curr = fieldErrors;
              let i = 0;
              while (i < issue.path.length) {
                const el = issue.path[i];
                const terminal = i === issue.path.length - 1;
                if (!terminal) {
                  curr[el] = curr[el] || { _errors: [] };
                } else {
                  curr[el] = curr[el] || { _errors: [] };
                  curr[el]._errors.push(mapper(issue));
                }
                curr = curr[el];
                i++;
              }
            }
          }
        };
        processError(this);
        return fieldErrors;
      }
      static assert(value) {
        if (!(value instanceof _ZodError)) {
          throw new Error(`Not a ZodError: ${value}`);
        }
      }
      toString() {
        return this.message;
      }
      get message() {
        return JSON.stringify(this.issues, util_js_1.util.jsonStringifyReplacer, 2);
      }
      get isEmpty() {
        return this.issues.length === 0;
      }
      flatten(mapper = (issue) => issue.message) {
        const fieldErrors = {};
        const formErrors = [];
        for (const sub of this.issues) {
          if (sub.path.length > 0) {
            const firstEl = sub.path[0];
            fieldErrors[firstEl] = fieldErrors[firstEl] || [];
            fieldErrors[firstEl].push(mapper(sub));
          } else {
            formErrors.push(mapper(sub));
          }
        }
        return { formErrors, fieldErrors };
      }
      get formErrors() {
        return this.flatten();
      }
    };
    exports.ZodError = ZodError;
    ZodError.create = (issues) => {
      const error = new ZodError(issues);
      return error;
    };
  }
});
var require_en = __commonJS({
  "node_modules/zod/v3/locales/en.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var ZodError_js_1 = require_ZodError();
    var util_js_1 = require_util();
    var errorMap = (issue, _ctx) => {
      let message;
      switch (issue.code) {
        case ZodError_js_1.ZodIssueCode.invalid_type:
          if (issue.received === util_js_1.ZodParsedType.undefined) {
            message = "Required";
          } else {
            message = `Expected ${issue.expected}, received ${issue.received}`;
          }
          break;
        case ZodError_js_1.ZodIssueCode.invalid_literal:
          message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util_js_1.util.jsonStringifyReplacer)}`;
          break;
        case ZodError_js_1.ZodIssueCode.unrecognized_keys:
          message = `Unrecognized key(s) in object: ${util_js_1.util.joinValues(issue.keys, ", ")}`;
          break;
        case ZodError_js_1.ZodIssueCode.invalid_union:
          message = `Invalid input`;
          break;
        case ZodError_js_1.ZodIssueCode.invalid_union_discriminator:
          message = `Invalid discriminator value. Expected ${util_js_1.util.joinValues(issue.options)}`;
          break;
        case ZodError_js_1.ZodIssueCode.invalid_enum_value:
          message = `Invalid enum value. Expected ${util_js_1.util.joinValues(issue.options)}, received '${issue.received}'`;
          break;
        case ZodError_js_1.ZodIssueCode.invalid_arguments:
          message = `Invalid function arguments`;
          break;
        case ZodError_js_1.ZodIssueCode.invalid_return_type:
          message = `Invalid function return type`;
          break;
        case ZodError_js_1.ZodIssueCode.invalid_date:
          message = `Invalid date`;
          break;
        case ZodError_js_1.ZodIssueCode.invalid_string:
          if (typeof issue.validation === "object") {
            if ("includes" in issue.validation) {
              message = `Invalid input: must include "${issue.validation.includes}"`;
              if (typeof issue.validation.position === "number") {
                message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
              }
            } else if ("startsWith" in issue.validation) {
              message = `Invalid input: must start with "${issue.validation.startsWith}"`;
            } else if ("endsWith" in issue.validation) {
              message = `Invalid input: must end with "${issue.validation.endsWith}"`;
            } else {
              util_js_1.util.assertNever(issue.validation);
            }
          } else if (issue.validation !== "regex") {
            message = `Invalid ${issue.validation}`;
          } else {
            message = "Invalid";
          }
          break;
        case ZodError_js_1.ZodIssueCode.too_small:
          if (issue.type === "array")
            message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
          else if (issue.type === "string")
            message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
          else if (issue.type === "number")
            message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
          else if (issue.type === "bigint")
            message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
          else if (issue.type === "date")
            message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
          else
            message = "Invalid input";
          break;
        case ZodError_js_1.ZodIssueCode.too_big:
          if (issue.type === "array")
            message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
          else if (issue.type === "string")
            message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
          else if (issue.type === "number")
            message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
          else if (issue.type === "bigint")
            message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
          else if (issue.type === "date")
            message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
          else
            message = "Invalid input";
          break;
        case ZodError_js_1.ZodIssueCode.custom:
          message = `Invalid input`;
          break;
        case ZodError_js_1.ZodIssueCode.invalid_intersection_types:
          message = `Intersection results could not be merged`;
          break;
        case ZodError_js_1.ZodIssueCode.not_multiple_of:
          message = `Number must be a multiple of ${issue.multipleOf}`;
          break;
        case ZodError_js_1.ZodIssueCode.not_finite:
          message = "Number must be finite";
          break;
        default:
          message = _ctx.defaultError;
          util_js_1.util.assertNever(issue);
      }
      return { message };
    };
    exports.default = errorMap;
  }
});
var require_errors = __commonJS({
  "node_modules/zod/v3/errors.cjs"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.defaultErrorMap = void 0;
    exports.setErrorMap = setErrorMap;
    exports.getErrorMap = getErrorMap;
    var en_js_1 = __importDefault(require_en());
    exports.defaultErrorMap = en_js_1.default;
    var overrideErrorMap = en_js_1.default;
    function setErrorMap(map) {
      overrideErrorMap = map;
    }
    function getErrorMap() {
      return overrideErrorMap;
    }
  }
});
var require_parseUtil = __commonJS({
  "node_modules/zod/v3/helpers/parseUtil.cjs"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.isAsync = exports.isValid = exports.isDirty = exports.isAborted = exports.OK = exports.DIRTY = exports.INVALID = exports.ParseStatus = exports.EMPTY_PATH = exports.makeIssue = void 0;
    exports.addIssueToContext = addIssueToContext;
    var errors_js_1 = require_errors();
    var en_js_1 = __importDefault(require_en());
    var makeIssue = (params) => {
      const { data, path, errorMaps, issueData } = params;
      const fullPath = [...path, ...issueData.path || []];
      const fullIssue = {
        ...issueData,
        path: fullPath
      };
      if (issueData.message !== void 0) {
        return {
          ...issueData,
          path: fullPath,
          message: issueData.message
        };
      }
      let errorMessage = "";
      const maps = errorMaps.filter((m) => !!m).slice().reverse();
      for (const map of maps) {
        errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
      }
      return {
        ...issueData,
        path: fullPath,
        message: errorMessage
      };
    };
    exports.makeIssue = makeIssue;
    exports.EMPTY_PATH = [];
    function addIssueToContext(ctx, issueData) {
      const overrideMap = (0, errors_js_1.getErrorMap)();
      const issue = (0, exports.makeIssue)({
        issueData,
        data: ctx.data,
        path: ctx.path,
        errorMaps: [
          ctx.common.contextualErrorMap,
          // contextual error map is first priority
          ctx.schemaErrorMap,
          // then schema-bound map if available
          overrideMap,
          // then global override map
          overrideMap === en_js_1.default ? void 0 : en_js_1.default
          // then global default map
        ].filter((x) => !!x)
      });
      ctx.common.issues.push(issue);
    }
    var ParseStatus = class _ParseStatus {
      constructor() {
        this.value = "valid";
      }
      dirty() {
        if (this.value === "valid")
          this.value = "dirty";
      }
      abort() {
        if (this.value !== "aborted")
          this.value = "aborted";
      }
      static mergeArray(status, results) {
        const arrayValue = [];
        for (const s of results) {
          if (s.status === "aborted")
            return exports.INVALID;
          if (s.status === "dirty")
            status.dirty();
          arrayValue.push(s.value);
        }
        return { status: status.value, value: arrayValue };
      }
      static async mergeObjectAsync(status, pairs) {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value
          });
        }
        return _ParseStatus.mergeObjectSync(status, syncPairs);
      }
      static mergeObjectSync(status, pairs) {
        const finalObject = {};
        for (const pair of pairs) {
          const { key, value } = pair;
          if (key.status === "aborted")
            return exports.INVALID;
          if (value.status === "aborted")
            return exports.INVALID;
          if (key.status === "dirty")
            status.dirty();
          if (value.status === "dirty")
            status.dirty();
          if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
            finalObject[key.value] = value.value;
          }
        }
        return { status: status.value, value: finalObject };
      }
    };
    exports.ParseStatus = ParseStatus;
    exports.INVALID = Object.freeze({
      status: "aborted"
    });
    var DIRTY = (value) => ({ status: "dirty", value });
    exports.DIRTY = DIRTY;
    var OK = (value) => ({ status: "valid", value });
    exports.OK = OK;
    var isAborted = (x) => x.status === "aborted";
    exports.isAborted = isAborted;
    var isDirty = (x) => x.status === "dirty";
    exports.isDirty = isDirty;
    var isValid = (x) => x.status === "valid";
    exports.isValid = isValid;
    var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;
    exports.isAsync = isAsync;
  }
});
var require_typeAliases = __commonJS({
  "node_modules/zod/v3/helpers/typeAliases.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
  }
});
var require_errorUtil = __commonJS({
  "node_modules/zod/v3/helpers/errorUtil.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.errorUtil = void 0;
    var errorUtil;
    (function(errorUtil2) {
      errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
      errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
    })(errorUtil || (exports.errorUtil = errorUtil = {}));
  }
});
var require_types = __commonJS({
  "node_modules/zod/v3/types.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.discriminatedUnion = exports.date = exports.boolean = exports.bigint = exports.array = exports.any = exports.coerce = exports.ZodFirstPartyTypeKind = exports.late = exports.ZodSchema = exports.Schema = exports.ZodReadonly = exports.ZodPipeline = exports.ZodBranded = exports.BRAND = exports.ZodNaN = exports.ZodCatch = exports.ZodDefault = exports.ZodNullable = exports.ZodOptional = exports.ZodTransformer = exports.ZodEffects = exports.ZodPromise = exports.ZodNativeEnum = exports.ZodEnum = exports.ZodLiteral = exports.ZodLazy = exports.ZodFunction = exports.ZodSet = exports.ZodMap = exports.ZodRecord = exports.ZodTuple = exports.ZodIntersection = exports.ZodDiscriminatedUnion = exports.ZodUnion = exports.ZodObject = exports.ZodArray = exports.ZodVoid = exports.ZodNever = exports.ZodUnknown = exports.ZodAny = exports.ZodNull = exports.ZodUndefined = exports.ZodSymbol = exports.ZodDate = exports.ZodBoolean = exports.ZodBigInt = exports.ZodNumber = exports.ZodString = exports.ZodType = void 0;
    exports.NEVER = exports.void = exports.unknown = exports.union = exports.undefined = exports.tuple = exports.transformer = exports.symbol = exports.string = exports.strictObject = exports.set = exports.record = exports.promise = exports.preprocess = exports.pipeline = exports.ostring = exports.optional = exports.onumber = exports.oboolean = exports.object = exports.number = exports.nullable = exports.null = exports.never = exports.nativeEnum = exports.nan = exports.map = exports.literal = exports.lazy = exports.intersection = exports.instanceof = exports.function = exports.enum = exports.effect = void 0;
    exports.datetimeRegex = datetimeRegex;
    exports.custom = custom;
    var ZodError_js_1 = require_ZodError();
    var errors_js_1 = require_errors();
    var errorUtil_js_1 = require_errorUtil();
    var parseUtil_js_1 = require_parseUtil();
    var util_js_1 = require_util();
    var ParseInputLazyPath = class {
      constructor(parent, value, path, key) {
        this._cachedPath = [];
        this.parent = parent;
        this.data = value;
        this._path = path;
        this._key = key;
      }
      get path() {
        if (!this._cachedPath.length) {
          if (Array.isArray(this._key)) {
            this._cachedPath.push(...this._path, ...this._key);
          } else {
            this._cachedPath.push(...this._path, this._key);
          }
        }
        return this._cachedPath;
      }
    };
    var handleResult = (ctx, result) => {
      if ((0, parseUtil_js_1.isValid)(result)) {
        return { success: true, data: result.value };
      } else {
        if (!ctx.common.issues.length) {
          throw new Error("Validation failed but no issues detected.");
        }
        return {
          success: false,
          get error() {
            if (this._error)
              return this._error;
            const error = new ZodError_js_1.ZodError(ctx.common.issues);
            this._error = error;
            return this._error;
          }
        };
      }
    };
    function processCreateParams(params) {
      if (!params)
        return {};
      const { errorMap, invalid_type_error, required_error, description } = params;
      if (errorMap && (invalid_type_error || required_error)) {
        throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
      }
      if (errorMap)
        return { errorMap, description };
      const customMap = (iss, ctx) => {
        const { message } = params;
        if (iss.code === "invalid_enum_value") {
          return { message: message ?? ctx.defaultError };
        }
        if (typeof ctx.data === "undefined") {
          return { message: message ?? required_error ?? ctx.defaultError };
        }
        if (iss.code !== "invalid_type")
          return { message: ctx.defaultError };
        return { message: message ?? invalid_type_error ?? ctx.defaultError };
      };
      return { errorMap: customMap, description };
    }
    var ZodType = class {
      get description() {
        return this._def.description;
      }
      _getType(input) {
        return (0, util_js_1.getParsedType)(input.data);
      }
      _getOrReturnCtx(input, ctx) {
        return ctx || {
          common: input.parent.common,
          data: input.data,
          parsedType: (0, util_js_1.getParsedType)(input.data),
          schemaErrorMap: this._def.errorMap,
          path: input.path,
          parent: input.parent
        };
      }
      _processInputParams(input) {
        return {
          status: new parseUtil_js_1.ParseStatus(),
          ctx: {
            common: input.parent.common,
            data: input.data,
            parsedType: (0, util_js_1.getParsedType)(input.data),
            schemaErrorMap: this._def.errorMap,
            path: input.path,
            parent: input.parent
          }
        };
      }
      _parseSync(input) {
        const result = this._parse(input);
        if ((0, parseUtil_js_1.isAsync)(result)) {
          throw new Error("Synchronous parse encountered promise.");
        }
        return result;
      }
      _parseAsync(input) {
        const result = this._parse(input);
        return Promise.resolve(result);
      }
      parse(data, params) {
        const result = this.safeParse(data, params);
        if (result.success)
          return result.data;
        throw result.error;
      }
      safeParse(data, params) {
        const ctx = {
          common: {
            issues: [],
            async: params?.async ?? false,
            contextualErrorMap: params?.errorMap
          },
          path: params?.path || [],
          schemaErrorMap: this._def.errorMap,
          parent: null,
          data,
          parsedType: (0, util_js_1.getParsedType)(data)
        };
        const result = this._parseSync({ data, path: ctx.path, parent: ctx });
        return handleResult(ctx, result);
      }
      "~validate"(data) {
        const ctx = {
          common: {
            issues: [],
            async: !!this["~standard"].async
          },
          path: [],
          schemaErrorMap: this._def.errorMap,
          parent: null,
          data,
          parsedType: (0, util_js_1.getParsedType)(data)
        };
        if (!this["~standard"].async) {
          try {
            const result = this._parseSync({ data, path: [], parent: ctx });
            return (0, parseUtil_js_1.isValid)(result) ? {
              value: result.value
            } : {
              issues: ctx.common.issues
            };
          } catch (err2) {
            if (err2?.message?.toLowerCase()?.includes("encountered")) {
              this["~standard"].async = true;
            }
            ctx.common = {
              issues: [],
              async: true
            };
          }
        }
        return this._parseAsync({ data, path: [], parent: ctx }).then((result) => (0, parseUtil_js_1.isValid)(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        });
      }
      async parseAsync(data, params) {
        const result = await this.safeParseAsync(data, params);
        if (result.success)
          return result.data;
        throw result.error;
      }
      async safeParseAsync(data, params) {
        const ctx = {
          common: {
            issues: [],
            contextualErrorMap: params?.errorMap,
            async: true
          },
          path: params?.path || [],
          schemaErrorMap: this._def.errorMap,
          parent: null,
          data,
          parsedType: (0, util_js_1.getParsedType)(data)
        };
        const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
        const result = await ((0, parseUtil_js_1.isAsync)(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
        return handleResult(ctx, result);
      }
      refine(check, message) {
        const getIssueProperties = (val) => {
          if (typeof message === "string" || typeof message === "undefined") {
            return { message };
          } else if (typeof message === "function") {
            return message(val);
          } else {
            return message;
          }
        };
        return this._refinement((val, ctx) => {
          const result = check(val);
          const setError = () => ctx.addIssue({
            code: ZodError_js_1.ZodIssueCode.custom,
            ...getIssueProperties(val)
          });
          if (typeof Promise !== "undefined" && result instanceof Promise) {
            return result.then((data) => {
              if (!data) {
                setError();
                return false;
              } else {
                return true;
              }
            });
          }
          if (!result) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      refinement(check, refinementData) {
        return this._refinement((val, ctx) => {
          if (!check(val)) {
            ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
            return false;
          } else {
            return true;
          }
        });
      }
      _refinement(refinement) {
        return new ZodEffects({
          schema: this,
          typeName: ZodFirstPartyTypeKind.ZodEffects,
          effect: { type: "refinement", refinement }
        });
      }
      superRefine(refinement) {
        return this._refinement(refinement);
      }
      constructor(def) {
        this.spa = this.safeParseAsync;
        this._def = def;
        this.parse = this.parse.bind(this);
        this.safeParse = this.safeParse.bind(this);
        this.parseAsync = this.parseAsync.bind(this);
        this.safeParseAsync = this.safeParseAsync.bind(this);
        this.spa = this.spa.bind(this);
        this.refine = this.refine.bind(this);
        this.refinement = this.refinement.bind(this);
        this.superRefine = this.superRefine.bind(this);
        this.optional = this.optional.bind(this);
        this.nullable = this.nullable.bind(this);
        this.nullish = this.nullish.bind(this);
        this.array = this.array.bind(this);
        this.promise = this.promise.bind(this);
        this.or = this.or.bind(this);
        this.and = this.and.bind(this);
        this.transform = this.transform.bind(this);
        this.brand = this.brand.bind(this);
        this.default = this.default.bind(this);
        this.catch = this.catch.bind(this);
        this.describe = this.describe.bind(this);
        this.pipe = this.pipe.bind(this);
        this.readonly = this.readonly.bind(this);
        this.isNullable = this.isNullable.bind(this);
        this.isOptional = this.isOptional.bind(this);
        this["~standard"] = {
          version: 1,
          vendor: "zod",
          validate: (data) => this["~validate"](data)
        };
      }
      optional() {
        return ZodOptional.create(this, this._def);
      }
      nullable() {
        return ZodNullable.create(this, this._def);
      }
      nullish() {
        return this.nullable().optional();
      }
      array() {
        return ZodArray.create(this);
      }
      promise() {
        return ZodPromise.create(this, this._def);
      }
      or(option) {
        return ZodUnion.create([this, option], this._def);
      }
      and(incoming) {
        return ZodIntersection.create(this, incoming, this._def);
      }
      transform(transform) {
        return new ZodEffects({
          ...processCreateParams(this._def),
          schema: this,
          typeName: ZodFirstPartyTypeKind.ZodEffects,
          effect: { type: "transform", transform }
        });
      }
      default(def) {
        const defaultValueFunc = typeof def === "function" ? def : () => def;
        return new ZodDefault({
          ...processCreateParams(this._def),
          innerType: this,
          defaultValue: defaultValueFunc,
          typeName: ZodFirstPartyTypeKind.ZodDefault
        });
      }
      brand() {
        return new ZodBranded({
          typeName: ZodFirstPartyTypeKind.ZodBranded,
          type: this,
          ...processCreateParams(this._def)
        });
      }
      catch(def) {
        const catchValueFunc = typeof def === "function" ? def : () => def;
        return new ZodCatch({
          ...processCreateParams(this._def),
          innerType: this,
          catchValue: catchValueFunc,
          typeName: ZodFirstPartyTypeKind.ZodCatch
        });
      }
      describe(description) {
        const This = this.constructor;
        return new This({
          ...this._def,
          description
        });
      }
      pipe(target) {
        return ZodPipeline.create(this, target);
      }
      readonly() {
        return ZodReadonly.create(this);
      }
      isOptional() {
        return this.safeParse(void 0).success;
      }
      isNullable() {
        return this.safeParse(null).success;
      }
    };
    exports.ZodType = ZodType;
    exports.Schema = ZodType;
    exports.ZodSchema = ZodType;
    var cuidRegex = /^c[^\s-]{8,}$/i;
    var cuid2Regex = /^[0-9a-z]+$/;
    var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
    var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
    var nanoidRegex = /^[a-z0-9_-]{21}$/i;
    var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
    var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
    var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
    var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
    var emojiRegex;
    var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
    var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
    var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
    var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
    var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
    var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
    var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
    var dateRegex = new RegExp(`^${dateRegexSource}$`);
    function timeRegexSource(args) {
      let secondsRegexSource = `[0-5]\\d`;
      if (args.precision) {
        secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
      } else if (args.precision == null) {
        secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
      }
      const secondsQuantifier = args.precision ? "+" : "?";
      return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
    }
    function timeRegex(args) {
      return new RegExp(`^${timeRegexSource(args)}$`);
    }
    function datetimeRegex(args) {
      let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
      const opts = [];
      opts.push(args.local ? `Z?` : `Z`);
      if (args.offset)
        opts.push(`([+-]\\d{2}:?\\d{2})`);
      regex = `${regex}(${opts.join("|")})`;
      return new RegExp(`^${regex}$`);
    }
    function isValidIP(ip, version) {
      if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
        return true;
      }
      if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
        return true;
      }
      return false;
    }
    function isValidJWT(jwt, alg) {
      if (!jwtRegex.test(jwt))
        return false;
      try {
        const [header] = jwt.split(".");
        if (!header)
          return false;
        const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
        const decoded = JSON.parse(atob(base64));
        if (typeof decoded !== "object" || decoded === null)
          return false;
        if ("typ" in decoded && decoded?.typ !== "JWT")
          return false;
        if (!decoded.alg)
          return false;
        if (alg && decoded.alg !== alg)
          return false;
        return true;
      } catch {
        return false;
      }
    }
    function isValidCidr(ip, version) {
      if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
        return true;
      }
      if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
        return true;
      }
      return false;
    }
    var ZodString = class _ZodString extends ZodType {
      _parse(input) {
        if (this._def.coerce) {
          input.data = String(input.data);
        }
        const parsedType = this._getType(input);
        if (parsedType !== util_js_1.ZodParsedType.string) {
          const ctx2 = this._getOrReturnCtx(input);
          (0, parseUtil_js_1.addIssueToContext)(ctx2, {
            code: ZodError_js_1.ZodIssueCode.invalid_type,
            expected: util_js_1.ZodParsedType.string,
            received: ctx2.parsedType
          });
          return parseUtil_js_1.INVALID;
        }
        const status = new parseUtil_js_1.ParseStatus();
        let ctx = void 0;
        for (const check of this._def.checks) {
          if (check.kind === "min") {
            if (input.data.length < check.value) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                code: ZodError_js_1.ZodIssueCode.too_small,
                minimum: check.value,
                type: "string",
                inclusive: true,
                exact: false,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "max") {
            if (input.data.length > check.value) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                code: ZodError_js_1.ZodIssueCode.too_big,
                maximum: check.value,
                type: "string",
                inclusive: true,
                exact: false,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "length") {
            const tooBig = input.data.length > check.value;
            const tooSmall = input.data.length < check.value;
            if (tooBig || tooSmall) {
              ctx = this._getOrReturnCtx(input, ctx);
              if (tooBig) {
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  code: ZodError_js_1.ZodIssueCode.too_big,
                  maximum: check.value,
                  type: "string",
                  inclusive: true,
                  exact: true,
                  message: check.message
                });
              } else if (tooSmall) {
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  code: ZodError_js_1.ZodIssueCode.too_small,
                  minimum: check.value,
                  type: "string",
                  inclusive: true,
                  exact: true,
                  message: check.message
                });
              }
              status.dirty();
            }
          } else if (check.kind === "email") {
            if (!emailRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                validation: "email",
                code: ZodError_js_1.ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "emoji") {
            if (!emojiRegex) {
              emojiRegex = new RegExp(_emojiRegex, "u");
            }
            if (!emojiRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                validation: "emoji",
                code: ZodError_js_1.ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "uuid") {
            if (!uuidRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                validation: "uuid",
                code: ZodError_js_1.ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "nanoid") {
            if (!nanoidRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                validation: "nanoid",
                code: ZodError_js_1.ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "cuid") {
            if (!cuidRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                validation: "cuid",
                code: ZodError_js_1.ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "cuid2") {
            if (!cuid2Regex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                validation: "cuid2",
                code: ZodError_js_1.ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "ulid") {
            if (!ulidRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                validation: "ulid",
                code: ZodError_js_1.ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "url") {
            try {
              new URL(input.data);
            } catch {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                validation: "url",
                code: ZodError_js_1.ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "regex") {
            check.regex.lastIndex = 0;
            const testResult = check.regex.test(input.data);
            if (!testResult) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                validation: "regex",
                code: ZodError_js_1.ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "trim") {
            input.data = input.data.trim();
          } else if (check.kind === "includes") {
            if (!input.data.includes(check.value, check.position)) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                code: ZodError_js_1.ZodIssueCode.invalid_string,
                validation: { includes: check.value, position: check.position },
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "toLowerCase") {
            input.data = input.data.toLowerCase();
          } else if (check.kind === "toUpperCase") {
            input.data = input.data.toUpperCase();
          } else if (check.kind === "startsWith") {
            if (!input.data.startsWith(check.value)) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                code: ZodError_js_1.ZodIssueCode.invalid_string,
                validation: { startsWith: check.value },
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "endsWith") {
            if (!input.data.endsWith(check.value)) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                code: ZodError_js_1.ZodIssueCode.invalid_string,
                validation: { endsWith: check.value },
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "datetime") {
            const regex = datetimeRegex(check);
            if (!regex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                code: ZodError_js_1.ZodIssueCode.invalid_string,
                validation: "datetime",
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "date") {
            const regex = dateRegex;
            if (!regex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                code: ZodError_js_1.ZodIssueCode.invalid_string,
                validation: "date",
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "time") {
            const regex = timeRegex(check);
            if (!regex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                code: ZodError_js_1.ZodIssueCode.invalid_string,
                validation: "time",
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "duration") {
            if (!durationRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                validation: "duration",
                code: ZodError_js_1.ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "ip") {
            if (!isValidIP(input.data, check.version)) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                validation: "ip",
                code: ZodError_js_1.ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "jwt") {
            if (!isValidJWT(input.data, check.alg)) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                validation: "jwt",
                code: ZodError_js_1.ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "cidr") {
            if (!isValidCidr(input.data, check.version)) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                validation: "cidr",
                code: ZodError_js_1.ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "base64") {
            if (!base64Regex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                validation: "base64",
                code: ZodError_js_1.ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "base64url") {
            if (!base64urlRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                validation: "base64url",
                code: ZodError_js_1.ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else {
            util_js_1.util.assertNever(check);
          }
        }
        return { status: status.value, value: input.data };
      }
      _regex(regex, validation, message) {
        return this.refinement((data) => regex.test(data), {
          validation,
          code: ZodError_js_1.ZodIssueCode.invalid_string,
          ...errorUtil_js_1.errorUtil.errToObj(message)
        });
      }
      _addCheck(check) {
        return new _ZodString({
          ...this._def,
          checks: [...this._def.checks, check]
        });
      }
      email(message) {
        return this._addCheck({ kind: "email", ...errorUtil_js_1.errorUtil.errToObj(message) });
      }
      url(message) {
        return this._addCheck({ kind: "url", ...errorUtil_js_1.errorUtil.errToObj(message) });
      }
      emoji(message) {
        return this._addCheck({ kind: "emoji", ...errorUtil_js_1.errorUtil.errToObj(message) });
      }
      uuid(message) {
        return this._addCheck({ kind: "uuid", ...errorUtil_js_1.errorUtil.errToObj(message) });
      }
      nanoid(message) {
        return this._addCheck({ kind: "nanoid", ...errorUtil_js_1.errorUtil.errToObj(message) });
      }
      cuid(message) {
        return this._addCheck({ kind: "cuid", ...errorUtil_js_1.errorUtil.errToObj(message) });
      }
      cuid2(message) {
        return this._addCheck({ kind: "cuid2", ...errorUtil_js_1.errorUtil.errToObj(message) });
      }
      ulid(message) {
        return this._addCheck({ kind: "ulid", ...errorUtil_js_1.errorUtil.errToObj(message) });
      }
      base64(message) {
        return this._addCheck({ kind: "base64", ...errorUtil_js_1.errorUtil.errToObj(message) });
      }
      base64url(message) {
        return this._addCheck({
          kind: "base64url",
          ...errorUtil_js_1.errorUtil.errToObj(message)
        });
      }
      jwt(options) {
        return this._addCheck({ kind: "jwt", ...errorUtil_js_1.errorUtil.errToObj(options) });
      }
      ip(options) {
        return this._addCheck({ kind: "ip", ...errorUtil_js_1.errorUtil.errToObj(options) });
      }
      cidr(options) {
        return this._addCheck({ kind: "cidr", ...errorUtil_js_1.errorUtil.errToObj(options) });
      }
      datetime(options) {
        if (typeof options === "string") {
          return this._addCheck({
            kind: "datetime",
            precision: null,
            offset: false,
            local: false,
            message: options
          });
        }
        return this._addCheck({
          kind: "datetime",
          precision: typeof options?.precision === "undefined" ? null : options?.precision,
          offset: options?.offset ?? false,
          local: options?.local ?? false,
          ...errorUtil_js_1.errorUtil.errToObj(options?.message)
        });
      }
      date(message) {
        return this._addCheck({ kind: "date", message });
      }
      time(options) {
        if (typeof options === "string") {
          return this._addCheck({
            kind: "time",
            precision: null,
            message: options
          });
        }
        return this._addCheck({
          kind: "time",
          precision: typeof options?.precision === "undefined" ? null : options?.precision,
          ...errorUtil_js_1.errorUtil.errToObj(options?.message)
        });
      }
      duration(message) {
        return this._addCheck({ kind: "duration", ...errorUtil_js_1.errorUtil.errToObj(message) });
      }
      regex(regex, message) {
        return this._addCheck({
          kind: "regex",
          regex,
          ...errorUtil_js_1.errorUtil.errToObj(message)
        });
      }
      includes(value, options) {
        return this._addCheck({
          kind: "includes",
          value,
          position: options?.position,
          ...errorUtil_js_1.errorUtil.errToObj(options?.message)
        });
      }
      startsWith(value, message) {
        return this._addCheck({
          kind: "startsWith",
          value,
          ...errorUtil_js_1.errorUtil.errToObj(message)
        });
      }
      endsWith(value, message) {
        return this._addCheck({
          kind: "endsWith",
          value,
          ...errorUtil_js_1.errorUtil.errToObj(message)
        });
      }
      min(minLength, message) {
        return this._addCheck({
          kind: "min",
          value: minLength,
          ...errorUtil_js_1.errorUtil.errToObj(message)
        });
      }
      max(maxLength, message) {
        return this._addCheck({
          kind: "max",
          value: maxLength,
          ...errorUtil_js_1.errorUtil.errToObj(message)
        });
      }
      length(len, message) {
        return this._addCheck({
          kind: "length",
          value: len,
          ...errorUtil_js_1.errorUtil.errToObj(message)
        });
      }
      /**
       * Equivalent to `.min(1)`
       */
      nonempty(message) {
        return this.min(1, errorUtil_js_1.errorUtil.errToObj(message));
      }
      trim() {
        return new _ZodString({
          ...this._def,
          checks: [...this._def.checks, { kind: "trim" }]
        });
      }
      toLowerCase() {
        return new _ZodString({
          ...this._def,
          checks: [...this._def.checks, { kind: "toLowerCase" }]
        });
      }
      toUpperCase() {
        return new _ZodString({
          ...this._def,
          checks: [...this._def.checks, { kind: "toUpperCase" }]
        });
      }
      get isDatetime() {
        return !!this._def.checks.find((ch) => ch.kind === "datetime");
      }
      get isDate() {
        return !!this._def.checks.find((ch) => ch.kind === "date");
      }
      get isTime() {
        return !!this._def.checks.find((ch) => ch.kind === "time");
      }
      get isDuration() {
        return !!this._def.checks.find((ch) => ch.kind === "duration");
      }
      get isEmail() {
        return !!this._def.checks.find((ch) => ch.kind === "email");
      }
      get isURL() {
        return !!this._def.checks.find((ch) => ch.kind === "url");
      }
      get isEmoji() {
        return !!this._def.checks.find((ch) => ch.kind === "emoji");
      }
      get isUUID() {
        return !!this._def.checks.find((ch) => ch.kind === "uuid");
      }
      get isNANOID() {
        return !!this._def.checks.find((ch) => ch.kind === "nanoid");
      }
      get isCUID() {
        return !!this._def.checks.find((ch) => ch.kind === "cuid");
      }
      get isCUID2() {
        return !!this._def.checks.find((ch) => ch.kind === "cuid2");
      }
      get isULID() {
        return !!this._def.checks.find((ch) => ch.kind === "ulid");
      }
      get isIP() {
        return !!this._def.checks.find((ch) => ch.kind === "ip");
      }
      get isCIDR() {
        return !!this._def.checks.find((ch) => ch.kind === "cidr");
      }
      get isBase64() {
        return !!this._def.checks.find((ch) => ch.kind === "base64");
      }
      get isBase64url() {
        return !!this._def.checks.find((ch) => ch.kind === "base64url");
      }
      get minLength() {
        let min = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "min") {
            if (min === null || ch.value > min)
              min = ch.value;
          }
        }
        return min;
      }
      get maxLength() {
        let max = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "max") {
            if (max === null || ch.value < max)
              max = ch.value;
          }
        }
        return max;
      }
    };
    exports.ZodString = ZodString;
    ZodString.create = (params) => {
      return new ZodString({
        checks: [],
        typeName: ZodFirstPartyTypeKind.ZodString,
        coerce: params?.coerce ?? false,
        ...processCreateParams(params)
      });
    };
    function floatSafeRemainder(val, step) {
      const valDecCount = (val.toString().split(".")[1] || "").length;
      const stepDecCount = (step.toString().split(".")[1] || "").length;
      const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
      const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
      const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
      return valInt % stepInt / 10 ** decCount;
    }
    var ZodNumber = class _ZodNumber extends ZodType {
      constructor() {
        super(...arguments);
        this.min = this.gte;
        this.max = this.lte;
        this.step = this.multipleOf;
      }
      _parse(input) {
        if (this._def.coerce) {
          input.data = Number(input.data);
        }
        const parsedType = this._getType(input);
        if (parsedType !== util_js_1.ZodParsedType.number) {
          const ctx2 = this._getOrReturnCtx(input);
          (0, parseUtil_js_1.addIssueToContext)(ctx2, {
            code: ZodError_js_1.ZodIssueCode.invalid_type,
            expected: util_js_1.ZodParsedType.number,
            received: ctx2.parsedType
          });
          return parseUtil_js_1.INVALID;
        }
        let ctx = void 0;
        const status = new parseUtil_js_1.ParseStatus();
        for (const check of this._def.checks) {
          if (check.kind === "int") {
            if (!util_js_1.util.isInteger(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                code: ZodError_js_1.ZodIssueCode.invalid_type,
                expected: "integer",
                received: "float",
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "min") {
            const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
            if (tooSmall) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                code: ZodError_js_1.ZodIssueCode.too_small,
                minimum: check.value,
                type: "number",
                inclusive: check.inclusive,
                exact: false,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "max") {
            const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
            if (tooBig) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                code: ZodError_js_1.ZodIssueCode.too_big,
                maximum: check.value,
                type: "number",
                inclusive: check.inclusive,
                exact: false,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "multipleOf") {
            if (floatSafeRemainder(input.data, check.value) !== 0) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                code: ZodError_js_1.ZodIssueCode.not_multiple_of,
                multipleOf: check.value,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "finite") {
            if (!Number.isFinite(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                code: ZodError_js_1.ZodIssueCode.not_finite,
                message: check.message
              });
              status.dirty();
            }
          } else {
            util_js_1.util.assertNever(check);
          }
        }
        return { status: status.value, value: input.data };
      }
      gte(value, message) {
        return this.setLimit("min", value, true, errorUtil_js_1.errorUtil.toString(message));
      }
      gt(value, message) {
        return this.setLimit("min", value, false, errorUtil_js_1.errorUtil.toString(message));
      }
      lte(value, message) {
        return this.setLimit("max", value, true, errorUtil_js_1.errorUtil.toString(message));
      }
      lt(value, message) {
        return this.setLimit("max", value, false, errorUtil_js_1.errorUtil.toString(message));
      }
      setLimit(kind, value, inclusive, message) {
        return new _ZodNumber({
          ...this._def,
          checks: [
            ...this._def.checks,
            {
              kind,
              value,
              inclusive,
              message: errorUtil_js_1.errorUtil.toString(message)
            }
          ]
        });
      }
      _addCheck(check) {
        return new _ZodNumber({
          ...this._def,
          checks: [...this._def.checks, check]
        });
      }
      int(message) {
        return this._addCheck({
          kind: "int",
          message: errorUtil_js_1.errorUtil.toString(message)
        });
      }
      positive(message) {
        return this._addCheck({
          kind: "min",
          value: 0,
          inclusive: false,
          message: errorUtil_js_1.errorUtil.toString(message)
        });
      }
      negative(message) {
        return this._addCheck({
          kind: "max",
          value: 0,
          inclusive: false,
          message: errorUtil_js_1.errorUtil.toString(message)
        });
      }
      nonpositive(message) {
        return this._addCheck({
          kind: "max",
          value: 0,
          inclusive: true,
          message: errorUtil_js_1.errorUtil.toString(message)
        });
      }
      nonnegative(message) {
        return this._addCheck({
          kind: "min",
          value: 0,
          inclusive: true,
          message: errorUtil_js_1.errorUtil.toString(message)
        });
      }
      multipleOf(value, message) {
        return this._addCheck({
          kind: "multipleOf",
          value,
          message: errorUtil_js_1.errorUtil.toString(message)
        });
      }
      finite(message) {
        return this._addCheck({
          kind: "finite",
          message: errorUtil_js_1.errorUtil.toString(message)
        });
      }
      safe(message) {
        return this._addCheck({
          kind: "min",
          inclusive: true,
          value: Number.MIN_SAFE_INTEGER,
          message: errorUtil_js_1.errorUtil.toString(message)
        })._addCheck({
          kind: "max",
          inclusive: true,
          value: Number.MAX_SAFE_INTEGER,
          message: errorUtil_js_1.errorUtil.toString(message)
        });
      }
      get minValue() {
        let min = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "min") {
            if (min === null || ch.value > min)
              min = ch.value;
          }
        }
        return min;
      }
      get maxValue() {
        let max = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "max") {
            if (max === null || ch.value < max)
              max = ch.value;
          }
        }
        return max;
      }
      get isInt() {
        return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util_js_1.util.isInteger(ch.value));
      }
      get isFinite() {
        let max = null;
        let min = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
            return true;
          } else if (ch.kind === "min") {
            if (min === null || ch.value > min)
              min = ch.value;
          } else if (ch.kind === "max") {
            if (max === null || ch.value < max)
              max = ch.value;
          }
        }
        return Number.isFinite(min) && Number.isFinite(max);
      }
    };
    exports.ZodNumber = ZodNumber;
    ZodNumber.create = (params) => {
      return new ZodNumber({
        checks: [],
        typeName: ZodFirstPartyTypeKind.ZodNumber,
        coerce: params?.coerce || false,
        ...processCreateParams(params)
      });
    };
    var ZodBigInt = class _ZodBigInt extends ZodType {
      constructor() {
        super(...arguments);
        this.min = this.gte;
        this.max = this.lte;
      }
      _parse(input) {
        if (this._def.coerce) {
          try {
            input.data = BigInt(input.data);
          } catch {
            return this._getInvalidInput(input);
          }
        }
        const parsedType = this._getType(input);
        if (parsedType !== util_js_1.ZodParsedType.bigint) {
          return this._getInvalidInput(input);
        }
        let ctx = void 0;
        const status = new parseUtil_js_1.ParseStatus();
        for (const check of this._def.checks) {
          if (check.kind === "min") {
            const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
            if (tooSmall) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                code: ZodError_js_1.ZodIssueCode.too_small,
                type: "bigint",
                minimum: check.value,
                inclusive: check.inclusive,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "max") {
            const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
            if (tooBig) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                code: ZodError_js_1.ZodIssueCode.too_big,
                type: "bigint",
                maximum: check.value,
                inclusive: check.inclusive,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "multipleOf") {
            if (input.data % check.value !== BigInt(0)) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                code: ZodError_js_1.ZodIssueCode.not_multiple_of,
                multipleOf: check.value,
                message: check.message
              });
              status.dirty();
            }
          } else {
            util_js_1.util.assertNever(check);
          }
        }
        return { status: status.value, value: input.data };
      }
      _getInvalidInput(input) {
        const ctx = this._getOrReturnCtx(input);
        (0, parseUtil_js_1.addIssueToContext)(ctx, {
          code: ZodError_js_1.ZodIssueCode.invalid_type,
          expected: util_js_1.ZodParsedType.bigint,
          received: ctx.parsedType
        });
        return parseUtil_js_1.INVALID;
      }
      gte(value, message) {
        return this.setLimit("min", value, true, errorUtil_js_1.errorUtil.toString(message));
      }
      gt(value, message) {
        return this.setLimit("min", value, false, errorUtil_js_1.errorUtil.toString(message));
      }
      lte(value, message) {
        return this.setLimit("max", value, true, errorUtil_js_1.errorUtil.toString(message));
      }
      lt(value, message) {
        return this.setLimit("max", value, false, errorUtil_js_1.errorUtil.toString(message));
      }
      setLimit(kind, value, inclusive, message) {
        return new _ZodBigInt({
          ...this._def,
          checks: [
            ...this._def.checks,
            {
              kind,
              value,
              inclusive,
              message: errorUtil_js_1.errorUtil.toString(message)
            }
          ]
        });
      }
      _addCheck(check) {
        return new _ZodBigInt({
          ...this._def,
          checks: [...this._def.checks, check]
        });
      }
      positive(message) {
        return this._addCheck({
          kind: "min",
          value: BigInt(0),
          inclusive: false,
          message: errorUtil_js_1.errorUtil.toString(message)
        });
      }
      negative(message) {
        return this._addCheck({
          kind: "max",
          value: BigInt(0),
          inclusive: false,
          message: errorUtil_js_1.errorUtil.toString(message)
        });
      }
      nonpositive(message) {
        return this._addCheck({
          kind: "max",
          value: BigInt(0),
          inclusive: true,
          message: errorUtil_js_1.errorUtil.toString(message)
        });
      }
      nonnegative(message) {
        return this._addCheck({
          kind: "min",
          value: BigInt(0),
          inclusive: true,
          message: errorUtil_js_1.errorUtil.toString(message)
        });
      }
      multipleOf(value, message) {
        return this._addCheck({
          kind: "multipleOf",
          value,
          message: errorUtil_js_1.errorUtil.toString(message)
        });
      }
      get minValue() {
        let min = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "min") {
            if (min === null || ch.value > min)
              min = ch.value;
          }
        }
        return min;
      }
      get maxValue() {
        let max = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "max") {
            if (max === null || ch.value < max)
              max = ch.value;
          }
        }
        return max;
      }
    };
    exports.ZodBigInt = ZodBigInt;
    ZodBigInt.create = (params) => {
      return new ZodBigInt({
        checks: [],
        typeName: ZodFirstPartyTypeKind.ZodBigInt,
        coerce: params?.coerce ?? false,
        ...processCreateParams(params)
      });
    };
    var ZodBoolean = class extends ZodType {
      _parse(input) {
        if (this._def.coerce) {
          input.data = Boolean(input.data);
        }
        const parsedType = this._getType(input);
        if (parsedType !== util_js_1.ZodParsedType.boolean) {
          const ctx = this._getOrReturnCtx(input);
          (0, parseUtil_js_1.addIssueToContext)(ctx, {
            code: ZodError_js_1.ZodIssueCode.invalid_type,
            expected: util_js_1.ZodParsedType.boolean,
            received: ctx.parsedType
          });
          return parseUtil_js_1.INVALID;
        }
        return (0, parseUtil_js_1.OK)(input.data);
      }
    };
    exports.ZodBoolean = ZodBoolean;
    ZodBoolean.create = (params) => {
      return new ZodBoolean({
        typeName: ZodFirstPartyTypeKind.ZodBoolean,
        coerce: params?.coerce || false,
        ...processCreateParams(params)
      });
    };
    var ZodDate = class _ZodDate extends ZodType {
      _parse(input) {
        if (this._def.coerce) {
          input.data = new Date(input.data);
        }
        const parsedType = this._getType(input);
        if (parsedType !== util_js_1.ZodParsedType.date) {
          const ctx2 = this._getOrReturnCtx(input);
          (0, parseUtil_js_1.addIssueToContext)(ctx2, {
            code: ZodError_js_1.ZodIssueCode.invalid_type,
            expected: util_js_1.ZodParsedType.date,
            received: ctx2.parsedType
          });
          return parseUtil_js_1.INVALID;
        }
        if (Number.isNaN(input.data.getTime())) {
          const ctx2 = this._getOrReturnCtx(input);
          (0, parseUtil_js_1.addIssueToContext)(ctx2, {
            code: ZodError_js_1.ZodIssueCode.invalid_date
          });
          return parseUtil_js_1.INVALID;
        }
        const status = new parseUtil_js_1.ParseStatus();
        let ctx = void 0;
        for (const check of this._def.checks) {
          if (check.kind === "min") {
            if (input.data.getTime() < check.value) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                code: ZodError_js_1.ZodIssueCode.too_small,
                message: check.message,
                inclusive: true,
                exact: false,
                minimum: check.value,
                type: "date"
              });
              status.dirty();
            }
          } else if (check.kind === "max") {
            if (input.data.getTime() > check.value) {
              ctx = this._getOrReturnCtx(input, ctx);
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                code: ZodError_js_1.ZodIssueCode.too_big,
                message: check.message,
                inclusive: true,
                exact: false,
                maximum: check.value,
                type: "date"
              });
              status.dirty();
            }
          } else {
            util_js_1.util.assertNever(check);
          }
        }
        return {
          status: status.value,
          value: new Date(input.data.getTime())
        };
      }
      _addCheck(check) {
        return new _ZodDate({
          ...this._def,
          checks: [...this._def.checks, check]
        });
      }
      min(minDate, message) {
        return this._addCheck({
          kind: "min",
          value: minDate.getTime(),
          message: errorUtil_js_1.errorUtil.toString(message)
        });
      }
      max(maxDate, message) {
        return this._addCheck({
          kind: "max",
          value: maxDate.getTime(),
          message: errorUtil_js_1.errorUtil.toString(message)
        });
      }
      get minDate() {
        let min = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "min") {
            if (min === null || ch.value > min)
              min = ch.value;
          }
        }
        return min != null ? new Date(min) : null;
      }
      get maxDate() {
        let max = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "max") {
            if (max === null || ch.value < max)
              max = ch.value;
          }
        }
        return max != null ? new Date(max) : null;
      }
    };
    exports.ZodDate = ZodDate;
    ZodDate.create = (params) => {
      return new ZodDate({
        checks: [],
        coerce: params?.coerce || false,
        typeName: ZodFirstPartyTypeKind.ZodDate,
        ...processCreateParams(params)
      });
    };
    var ZodSymbol = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== util_js_1.ZodParsedType.symbol) {
          const ctx = this._getOrReturnCtx(input);
          (0, parseUtil_js_1.addIssueToContext)(ctx, {
            code: ZodError_js_1.ZodIssueCode.invalid_type,
            expected: util_js_1.ZodParsedType.symbol,
            received: ctx.parsedType
          });
          return parseUtil_js_1.INVALID;
        }
        return (0, parseUtil_js_1.OK)(input.data);
      }
    };
    exports.ZodSymbol = ZodSymbol;
    ZodSymbol.create = (params) => {
      return new ZodSymbol({
        typeName: ZodFirstPartyTypeKind.ZodSymbol,
        ...processCreateParams(params)
      });
    };
    var ZodUndefined = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== util_js_1.ZodParsedType.undefined) {
          const ctx = this._getOrReturnCtx(input);
          (0, parseUtil_js_1.addIssueToContext)(ctx, {
            code: ZodError_js_1.ZodIssueCode.invalid_type,
            expected: util_js_1.ZodParsedType.undefined,
            received: ctx.parsedType
          });
          return parseUtil_js_1.INVALID;
        }
        return (0, parseUtil_js_1.OK)(input.data);
      }
    };
    exports.ZodUndefined = ZodUndefined;
    ZodUndefined.create = (params) => {
      return new ZodUndefined({
        typeName: ZodFirstPartyTypeKind.ZodUndefined,
        ...processCreateParams(params)
      });
    };
    var ZodNull = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== util_js_1.ZodParsedType.null) {
          const ctx = this._getOrReturnCtx(input);
          (0, parseUtil_js_1.addIssueToContext)(ctx, {
            code: ZodError_js_1.ZodIssueCode.invalid_type,
            expected: util_js_1.ZodParsedType.null,
            received: ctx.parsedType
          });
          return parseUtil_js_1.INVALID;
        }
        return (0, parseUtil_js_1.OK)(input.data);
      }
    };
    exports.ZodNull = ZodNull;
    ZodNull.create = (params) => {
      return new ZodNull({
        typeName: ZodFirstPartyTypeKind.ZodNull,
        ...processCreateParams(params)
      });
    };
    var ZodAny = class extends ZodType {
      constructor() {
        super(...arguments);
        this._any = true;
      }
      _parse(input) {
        return (0, parseUtil_js_1.OK)(input.data);
      }
    };
    exports.ZodAny = ZodAny;
    ZodAny.create = (params) => {
      return new ZodAny({
        typeName: ZodFirstPartyTypeKind.ZodAny,
        ...processCreateParams(params)
      });
    };
    var ZodUnknown = class extends ZodType {
      constructor() {
        super(...arguments);
        this._unknown = true;
      }
      _parse(input) {
        return (0, parseUtil_js_1.OK)(input.data);
      }
    };
    exports.ZodUnknown = ZodUnknown;
    ZodUnknown.create = (params) => {
      return new ZodUnknown({
        typeName: ZodFirstPartyTypeKind.ZodUnknown,
        ...processCreateParams(params)
      });
    };
    var ZodNever = class extends ZodType {
      _parse(input) {
        const ctx = this._getOrReturnCtx(input);
        (0, parseUtil_js_1.addIssueToContext)(ctx, {
          code: ZodError_js_1.ZodIssueCode.invalid_type,
          expected: util_js_1.ZodParsedType.never,
          received: ctx.parsedType
        });
        return parseUtil_js_1.INVALID;
      }
    };
    exports.ZodNever = ZodNever;
    ZodNever.create = (params) => {
      return new ZodNever({
        typeName: ZodFirstPartyTypeKind.ZodNever,
        ...processCreateParams(params)
      });
    };
    var ZodVoid = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== util_js_1.ZodParsedType.undefined) {
          const ctx = this._getOrReturnCtx(input);
          (0, parseUtil_js_1.addIssueToContext)(ctx, {
            code: ZodError_js_1.ZodIssueCode.invalid_type,
            expected: util_js_1.ZodParsedType.void,
            received: ctx.parsedType
          });
          return parseUtil_js_1.INVALID;
        }
        return (0, parseUtil_js_1.OK)(input.data);
      }
    };
    exports.ZodVoid = ZodVoid;
    ZodVoid.create = (params) => {
      return new ZodVoid({
        typeName: ZodFirstPartyTypeKind.ZodVoid,
        ...processCreateParams(params)
      });
    };
    var ZodArray = class _ZodArray extends ZodType {
      _parse(input) {
        const { ctx, status } = this._processInputParams(input);
        const def = this._def;
        if (ctx.parsedType !== util_js_1.ZodParsedType.array) {
          (0, parseUtil_js_1.addIssueToContext)(ctx, {
            code: ZodError_js_1.ZodIssueCode.invalid_type,
            expected: util_js_1.ZodParsedType.array,
            received: ctx.parsedType
          });
          return parseUtil_js_1.INVALID;
        }
        if (def.exactLength !== null) {
          const tooBig = ctx.data.length > def.exactLength.value;
          const tooSmall = ctx.data.length < def.exactLength.value;
          if (tooBig || tooSmall) {
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              code: tooBig ? ZodError_js_1.ZodIssueCode.too_big : ZodError_js_1.ZodIssueCode.too_small,
              minimum: tooSmall ? def.exactLength.value : void 0,
              maximum: tooBig ? def.exactLength.value : void 0,
              type: "array",
              inclusive: true,
              exact: true,
              message: def.exactLength.message
            });
            status.dirty();
          }
        }
        if (def.minLength !== null) {
          if (ctx.data.length < def.minLength.value) {
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              code: ZodError_js_1.ZodIssueCode.too_small,
              minimum: def.minLength.value,
              type: "array",
              inclusive: true,
              exact: false,
              message: def.minLength.message
            });
            status.dirty();
          }
        }
        if (def.maxLength !== null) {
          if (ctx.data.length > def.maxLength.value) {
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              code: ZodError_js_1.ZodIssueCode.too_big,
              maximum: def.maxLength.value,
              type: "array",
              inclusive: true,
              exact: false,
              message: def.maxLength.message
            });
            status.dirty();
          }
        }
        if (ctx.common.async) {
          return Promise.all([...ctx.data].map((item, i) => {
            return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
          })).then((result2) => {
            return parseUtil_js_1.ParseStatus.mergeArray(status, result2);
          });
        }
        const result = [...ctx.data].map((item, i) => {
          return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
        });
        return parseUtil_js_1.ParseStatus.mergeArray(status, result);
      }
      get element() {
        return this._def.type;
      }
      min(minLength, message) {
        return new _ZodArray({
          ...this._def,
          minLength: { value: minLength, message: errorUtil_js_1.errorUtil.toString(message) }
        });
      }
      max(maxLength, message) {
        return new _ZodArray({
          ...this._def,
          maxLength: { value: maxLength, message: errorUtil_js_1.errorUtil.toString(message) }
        });
      }
      length(len, message) {
        return new _ZodArray({
          ...this._def,
          exactLength: { value: len, message: errorUtil_js_1.errorUtil.toString(message) }
        });
      }
      nonempty(message) {
        return this.min(1, message);
      }
    };
    exports.ZodArray = ZodArray;
    ZodArray.create = (schema, params) => {
      return new ZodArray({
        type: schema,
        minLength: null,
        maxLength: null,
        exactLength: null,
        typeName: ZodFirstPartyTypeKind.ZodArray,
        ...processCreateParams(params)
      });
    };
    function deepPartialify(schema) {
      if (schema instanceof ZodObject) {
        const newShape = {};
        for (const key in schema.shape) {
          const fieldSchema = schema.shape[key];
          newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
        }
        return new ZodObject({
          ...schema._def,
          shape: () => newShape
        });
      } else if (schema instanceof ZodArray) {
        return new ZodArray({
          ...schema._def,
          type: deepPartialify(schema.element)
        });
      } else if (schema instanceof ZodOptional) {
        return ZodOptional.create(deepPartialify(schema.unwrap()));
      } else if (schema instanceof ZodNullable) {
        return ZodNullable.create(deepPartialify(schema.unwrap()));
      } else if (schema instanceof ZodTuple) {
        return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
      } else {
        return schema;
      }
    }
    var ZodObject = class _ZodObject extends ZodType {
      constructor() {
        super(...arguments);
        this._cached = null;
        this.nonstrict = this.passthrough;
        this.augment = this.extend;
      }
      _getCached() {
        if (this._cached !== null)
          return this._cached;
        const shape = this._def.shape();
        const keys = util_js_1.util.objectKeys(shape);
        this._cached = { shape, keys };
        return this._cached;
      }
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== util_js_1.ZodParsedType.object) {
          const ctx2 = this._getOrReturnCtx(input);
          (0, parseUtil_js_1.addIssueToContext)(ctx2, {
            code: ZodError_js_1.ZodIssueCode.invalid_type,
            expected: util_js_1.ZodParsedType.object,
            received: ctx2.parsedType
          });
          return parseUtil_js_1.INVALID;
        }
        const { status, ctx } = this._processInputParams(input);
        const { shape, keys: shapeKeys } = this._getCached();
        const extraKeys = [];
        if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
          for (const key in ctx.data) {
            if (!shapeKeys.includes(key)) {
              extraKeys.push(key);
            }
          }
        }
        const pairs = [];
        for (const key of shapeKeys) {
          const keyValidator = shape[key];
          const value = ctx.data[key];
          pairs.push({
            key: { status: "valid", value: key },
            value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
            alwaysSet: key in ctx.data
          });
        }
        if (this._def.catchall instanceof ZodNever) {
          const unknownKeys = this._def.unknownKeys;
          if (unknownKeys === "passthrough") {
            for (const key of extraKeys) {
              pairs.push({
                key: { status: "valid", value: key },
                value: { status: "valid", value: ctx.data[key] }
              });
            }
          } else if (unknownKeys === "strict") {
            if (extraKeys.length > 0) {
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                code: ZodError_js_1.ZodIssueCode.unrecognized_keys,
                keys: extraKeys
              });
              status.dirty();
            }
          } else if (unknownKeys === "strip") {
          } else {
            throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
          }
        } else {
          const catchall = this._def.catchall;
          for (const key of extraKeys) {
            const value = ctx.data[key];
            pairs.push({
              key: { status: "valid", value: key },
              value: catchall._parse(
                new ParseInputLazyPath(ctx, value, ctx.path, key)
                //, ctx.child(key), value, getParsedType(value)
              ),
              alwaysSet: key in ctx.data
            });
          }
        }
        if (ctx.common.async) {
          return Promise.resolve().then(async () => {
            const syncPairs = [];
            for (const pair of pairs) {
              const key = await pair.key;
              const value = await pair.value;
              syncPairs.push({
                key,
                value,
                alwaysSet: pair.alwaysSet
              });
            }
            return syncPairs;
          }).then((syncPairs) => {
            return parseUtil_js_1.ParseStatus.mergeObjectSync(status, syncPairs);
          });
        } else {
          return parseUtil_js_1.ParseStatus.mergeObjectSync(status, pairs);
        }
      }
      get shape() {
        return this._def.shape();
      }
      strict(message) {
        errorUtil_js_1.errorUtil.errToObj;
        return new _ZodObject({
          ...this._def,
          unknownKeys: "strict",
          ...message !== void 0 ? {
            errorMap: (issue, ctx) => {
              const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
              if (issue.code === "unrecognized_keys")
                return {
                  message: errorUtil_js_1.errorUtil.errToObj(message).message ?? defaultError
                };
              return {
                message: defaultError
              };
            }
          } : {}
        });
      }
      strip() {
        return new _ZodObject({
          ...this._def,
          unknownKeys: "strip"
        });
      }
      passthrough() {
        return new _ZodObject({
          ...this._def,
          unknownKeys: "passthrough"
        });
      }
      // const AugmentFactory =
      //   <Def extends ZodObjectDef>(def: Def) =>
      //   <Augmentation extends ZodRawShape>(
      //     augmentation: Augmentation
      //   ): ZodObject<
      //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
      //     Def["unknownKeys"],
      //     Def["catchall"]
      //   > => {
      //     return new ZodObject({
      //       ...def,
      //       shape: () => ({
      //         ...def.shape(),
      //         ...augmentation,
      //       }),
      //     }) as any;
      //   };
      extend(augmentation) {
        return new _ZodObject({
          ...this._def,
          shape: () => ({
            ...this._def.shape(),
            ...augmentation
          })
        });
      }
      /**
       * Prior to zod@1.0.12 there was a bug in the
       * inferred type of merged objects. Please
       * upgrade if you are experiencing issues.
       */
      merge(merging) {
        const merged = new _ZodObject({
          unknownKeys: merging._def.unknownKeys,
          catchall: merging._def.catchall,
          shape: () => ({
            ...this._def.shape(),
            ...merging._def.shape()
          }),
          typeName: ZodFirstPartyTypeKind.ZodObject
        });
        return merged;
      }
      // merge<
      //   Incoming extends AnyZodObject,
      //   Augmentation extends Incoming["shape"],
      //   NewOutput extends {
      //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
      //       ? Augmentation[k]["_output"]
      //       : k extends keyof Output
      //       ? Output[k]
      //       : never;
      //   },
      //   NewInput extends {
      //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
      //       ? Augmentation[k]["_input"]
      //       : k extends keyof Input
      //       ? Input[k]
      //       : never;
      //   }
      // >(
      //   merging: Incoming
      // ): ZodObject<
      //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
      //   Incoming["_def"]["unknownKeys"],
      //   Incoming["_def"]["catchall"],
      //   NewOutput,
      //   NewInput
      // > {
      //   const merged: any = new ZodObject({
      //     unknownKeys: merging._def.unknownKeys,
      //     catchall: merging._def.catchall,
      //     shape: () =>
      //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
      //     typeName: ZodFirstPartyTypeKind.ZodObject,
      //   }) as any;
      //   return merged;
      // }
      setKey(key, schema) {
        return this.augment({ [key]: schema });
      }
      // merge<Incoming extends AnyZodObject>(
      //   merging: Incoming
      // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
      // ZodObject<
      //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
      //   Incoming["_def"]["unknownKeys"],
      //   Incoming["_def"]["catchall"]
      // > {
      //   // const mergedShape = objectUtil.mergeShapes(
      //   //   this._def.shape(),
      //   //   merging._def.shape()
      //   // );
      //   const merged: any = new ZodObject({
      //     unknownKeys: merging._def.unknownKeys,
      //     catchall: merging._def.catchall,
      //     shape: () =>
      //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
      //     typeName: ZodFirstPartyTypeKind.ZodObject,
      //   }) as any;
      //   return merged;
      // }
      catchall(index) {
        return new _ZodObject({
          ...this._def,
          catchall: index
        });
      }
      pick(mask) {
        const shape = {};
        for (const key of util_js_1.util.objectKeys(mask)) {
          if (mask[key] && this.shape[key]) {
            shape[key] = this.shape[key];
          }
        }
        return new _ZodObject({
          ...this._def,
          shape: () => shape
        });
      }
      omit(mask) {
        const shape = {};
        for (const key of util_js_1.util.objectKeys(this.shape)) {
          if (!mask[key]) {
            shape[key] = this.shape[key];
          }
        }
        return new _ZodObject({
          ...this._def,
          shape: () => shape
        });
      }
      /**
       * @deprecated
       */
      deepPartial() {
        return deepPartialify(this);
      }
      partial(mask) {
        const newShape = {};
        for (const key of util_js_1.util.objectKeys(this.shape)) {
          const fieldSchema = this.shape[key];
          if (mask && !mask[key]) {
            newShape[key] = fieldSchema;
          } else {
            newShape[key] = fieldSchema.optional();
          }
        }
        return new _ZodObject({
          ...this._def,
          shape: () => newShape
        });
      }
      required(mask) {
        const newShape = {};
        for (const key of util_js_1.util.objectKeys(this.shape)) {
          if (mask && !mask[key]) {
            newShape[key] = this.shape[key];
          } else {
            const fieldSchema = this.shape[key];
            let newField = fieldSchema;
            while (newField instanceof ZodOptional) {
              newField = newField._def.innerType;
            }
            newShape[key] = newField;
          }
        }
        return new _ZodObject({
          ...this._def,
          shape: () => newShape
        });
      }
      keyof() {
        return createZodEnum(util_js_1.util.objectKeys(this.shape));
      }
    };
    exports.ZodObject = ZodObject;
    ZodObject.create = (shape, params) => {
      return new ZodObject({
        shape: () => shape,
        unknownKeys: "strip",
        catchall: ZodNever.create(),
        typeName: ZodFirstPartyTypeKind.ZodObject,
        ...processCreateParams(params)
      });
    };
    ZodObject.strictCreate = (shape, params) => {
      return new ZodObject({
        shape: () => shape,
        unknownKeys: "strict",
        catchall: ZodNever.create(),
        typeName: ZodFirstPartyTypeKind.ZodObject,
        ...processCreateParams(params)
      });
    };
    ZodObject.lazycreate = (shape, params) => {
      return new ZodObject({
        shape,
        unknownKeys: "strip",
        catchall: ZodNever.create(),
        typeName: ZodFirstPartyTypeKind.ZodObject,
        ...processCreateParams(params)
      });
    };
    var ZodUnion = class extends ZodType {
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        const options = this._def.options;
        function handleResults(results) {
          for (const result of results) {
            if (result.result.status === "valid") {
              return result.result;
            }
          }
          for (const result of results) {
            if (result.result.status === "dirty") {
              ctx.common.issues.push(...result.ctx.common.issues);
              return result.result;
            }
          }
          const unionErrors = results.map((result) => new ZodError_js_1.ZodError(result.ctx.common.issues));
          (0, parseUtil_js_1.addIssueToContext)(ctx, {
            code: ZodError_js_1.ZodIssueCode.invalid_union,
            unionErrors
          });
          return parseUtil_js_1.INVALID;
        }
        if (ctx.common.async) {
          return Promise.all(options.map(async (option) => {
            const childCtx = {
              ...ctx,
              common: {
                ...ctx.common,
                issues: []
              },
              parent: null
            };
            return {
              result: await option._parseAsync({
                data: ctx.data,
                path: ctx.path,
                parent: childCtx
              }),
              ctx: childCtx
            };
          })).then(handleResults);
        } else {
          let dirty = void 0;
          const issues = [];
          for (const option of options) {
            const childCtx = {
              ...ctx,
              common: {
                ...ctx.common,
                issues: []
              },
              parent: null
            };
            const result = option._parseSync({
              data: ctx.data,
              path: ctx.path,
              parent: childCtx
            });
            if (result.status === "valid") {
              return result;
            } else if (result.status === "dirty" && !dirty) {
              dirty = { result, ctx: childCtx };
            }
            if (childCtx.common.issues.length) {
              issues.push(childCtx.common.issues);
            }
          }
          if (dirty) {
            ctx.common.issues.push(...dirty.ctx.common.issues);
            return dirty.result;
          }
          const unionErrors = issues.map((issues2) => new ZodError_js_1.ZodError(issues2));
          (0, parseUtil_js_1.addIssueToContext)(ctx, {
            code: ZodError_js_1.ZodIssueCode.invalid_union,
            unionErrors
          });
          return parseUtil_js_1.INVALID;
        }
      }
      get options() {
        return this._def.options;
      }
    };
    exports.ZodUnion = ZodUnion;
    ZodUnion.create = (types, params) => {
      return new ZodUnion({
        options: types,
        typeName: ZodFirstPartyTypeKind.ZodUnion,
        ...processCreateParams(params)
      });
    };
    var getDiscriminator = (type) => {
      if (type instanceof ZodLazy) {
        return getDiscriminator(type.schema);
      } else if (type instanceof ZodEffects) {
        return getDiscriminator(type.innerType());
      } else if (type instanceof ZodLiteral) {
        return [type.value];
      } else if (type instanceof ZodEnum) {
        return type.options;
      } else if (type instanceof ZodNativeEnum) {
        return util_js_1.util.objectValues(type.enum);
      } else if (type instanceof ZodDefault) {
        return getDiscriminator(type._def.innerType);
      } else if (type instanceof ZodUndefined) {
        return [void 0];
      } else if (type instanceof ZodNull) {
        return [null];
      } else if (type instanceof ZodOptional) {
        return [void 0, ...getDiscriminator(type.unwrap())];
      } else if (type instanceof ZodNullable) {
        return [null, ...getDiscriminator(type.unwrap())];
      } else if (type instanceof ZodBranded) {
        return getDiscriminator(type.unwrap());
      } else if (type instanceof ZodReadonly) {
        return getDiscriminator(type.unwrap());
      } else if (type instanceof ZodCatch) {
        return getDiscriminator(type._def.innerType);
      } else {
        return [];
      }
    };
    var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        if (ctx.parsedType !== util_js_1.ZodParsedType.object) {
          (0, parseUtil_js_1.addIssueToContext)(ctx, {
            code: ZodError_js_1.ZodIssueCode.invalid_type,
            expected: util_js_1.ZodParsedType.object,
            received: ctx.parsedType
          });
          return parseUtil_js_1.INVALID;
        }
        const discriminator = this.discriminator;
        const discriminatorValue = ctx.data[discriminator];
        const option = this.optionsMap.get(discriminatorValue);
        if (!option) {
          (0, parseUtil_js_1.addIssueToContext)(ctx, {
            code: ZodError_js_1.ZodIssueCode.invalid_union_discriminator,
            options: Array.from(this.optionsMap.keys()),
            path: [discriminator]
          });
          return parseUtil_js_1.INVALID;
        }
        if (ctx.common.async) {
          return option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          });
        } else {
          return option._parseSync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          });
        }
      }
      get discriminator() {
        return this._def.discriminator;
      }
      get options() {
        return this._def.options;
      }
      get optionsMap() {
        return this._def.optionsMap;
      }
      /**
       * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
       * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
       * have a different value for each object in the union.
       * @param discriminator the name of the discriminator property
       * @param types an array of object schemas
       * @param params
       */
      static create(discriminator, options, params) {
        const optionsMap = /* @__PURE__ */ new Map();
        for (const type of options) {
          const discriminatorValues = getDiscriminator(type.shape[discriminator]);
          if (!discriminatorValues.length) {
            throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
          }
          for (const value of discriminatorValues) {
            if (optionsMap.has(value)) {
              throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
            }
            optionsMap.set(value, type);
          }
        }
        return new _ZodDiscriminatedUnion({
          typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
          discriminator,
          options,
          optionsMap,
          ...processCreateParams(params)
        });
      }
    };
    exports.ZodDiscriminatedUnion = ZodDiscriminatedUnion;
    function mergeValues(a, b) {
      const aType = (0, util_js_1.getParsedType)(a);
      const bType = (0, util_js_1.getParsedType)(b);
      if (a === b) {
        return { valid: true, data: a };
      } else if (aType === util_js_1.ZodParsedType.object && bType === util_js_1.ZodParsedType.object) {
        const bKeys = util_js_1.util.objectKeys(b);
        const sharedKeys = util_js_1.util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
        const newObj = { ...a, ...b };
        for (const key of sharedKeys) {
          const sharedValue = mergeValues(a[key], b[key]);
          if (!sharedValue.valid) {
            return { valid: false };
          }
          newObj[key] = sharedValue.data;
        }
        return { valid: true, data: newObj };
      } else if (aType === util_js_1.ZodParsedType.array && bType === util_js_1.ZodParsedType.array) {
        if (a.length !== b.length) {
          return { valid: false };
        }
        const newArray = [];
        for (let index = 0; index < a.length; index++) {
          const itemA = a[index];
          const itemB = b[index];
          const sharedValue = mergeValues(itemA, itemB);
          if (!sharedValue.valid) {
            return { valid: false };
          }
          newArray.push(sharedValue.data);
        }
        return { valid: true, data: newArray };
      } else if (aType === util_js_1.ZodParsedType.date && bType === util_js_1.ZodParsedType.date && +a === +b) {
        return { valid: true, data: a };
      } else {
        return { valid: false };
      }
    }
    var ZodIntersection = class extends ZodType {
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        const handleParsed = (parsedLeft, parsedRight) => {
          if ((0, parseUtil_js_1.isAborted)(parsedLeft) || (0, parseUtil_js_1.isAborted)(parsedRight)) {
            return parseUtil_js_1.INVALID;
          }
          const merged = mergeValues(parsedLeft.value, parsedRight.value);
          if (!merged.valid) {
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              code: ZodError_js_1.ZodIssueCode.invalid_intersection_types
            });
            return parseUtil_js_1.INVALID;
          }
          if ((0, parseUtil_js_1.isDirty)(parsedLeft) || (0, parseUtil_js_1.isDirty)(parsedRight)) {
            status.dirty();
          }
          return { status: status.value, value: merged.data };
        };
        if (ctx.common.async) {
          return Promise.all([
            this._def.left._parseAsync({
              data: ctx.data,
              path: ctx.path,
              parent: ctx
            }),
            this._def.right._parseAsync({
              data: ctx.data,
              path: ctx.path,
              parent: ctx
            })
          ]).then(([left, right]) => handleParsed(left, right));
        } else {
          return handleParsed(this._def.left._parseSync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          }), this._def.right._parseSync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          }));
        }
      }
    };
    exports.ZodIntersection = ZodIntersection;
    ZodIntersection.create = (left, right, params) => {
      return new ZodIntersection({
        left,
        right,
        typeName: ZodFirstPartyTypeKind.ZodIntersection,
        ...processCreateParams(params)
      });
    };
    var ZodTuple = class _ZodTuple extends ZodType {
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        if (ctx.parsedType !== util_js_1.ZodParsedType.array) {
          (0, parseUtil_js_1.addIssueToContext)(ctx, {
            code: ZodError_js_1.ZodIssueCode.invalid_type,
            expected: util_js_1.ZodParsedType.array,
            received: ctx.parsedType
          });
          return parseUtil_js_1.INVALID;
        }
        if (ctx.data.length < this._def.items.length) {
          (0, parseUtil_js_1.addIssueToContext)(ctx, {
            code: ZodError_js_1.ZodIssueCode.too_small,
            minimum: this._def.items.length,
            inclusive: true,
            exact: false,
            type: "array"
          });
          return parseUtil_js_1.INVALID;
        }
        const rest = this._def.rest;
        if (!rest && ctx.data.length > this._def.items.length) {
          (0, parseUtil_js_1.addIssueToContext)(ctx, {
            code: ZodError_js_1.ZodIssueCode.too_big,
            maximum: this._def.items.length,
            inclusive: true,
            exact: false,
            type: "array"
          });
          status.dirty();
        }
        const items = [...ctx.data].map((item, itemIndex) => {
          const schema = this._def.items[itemIndex] || this._def.rest;
          if (!schema)
            return null;
          return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
        }).filter((x) => !!x);
        if (ctx.common.async) {
          return Promise.all(items).then((results) => {
            return parseUtil_js_1.ParseStatus.mergeArray(status, results);
          });
        } else {
          return parseUtil_js_1.ParseStatus.mergeArray(status, items);
        }
      }
      get items() {
        return this._def.items;
      }
      rest(rest) {
        return new _ZodTuple({
          ...this._def,
          rest
        });
      }
    };
    exports.ZodTuple = ZodTuple;
    ZodTuple.create = (schemas, params) => {
      if (!Array.isArray(schemas)) {
        throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
      }
      return new ZodTuple({
        items: schemas,
        typeName: ZodFirstPartyTypeKind.ZodTuple,
        rest: null,
        ...processCreateParams(params)
      });
    };
    var ZodRecord = class _ZodRecord extends ZodType {
      get keySchema() {
        return this._def.keyType;
      }
      get valueSchema() {
        return this._def.valueType;
      }
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        if (ctx.parsedType !== util_js_1.ZodParsedType.object) {
          (0, parseUtil_js_1.addIssueToContext)(ctx, {
            code: ZodError_js_1.ZodIssueCode.invalid_type,
            expected: util_js_1.ZodParsedType.object,
            received: ctx.parsedType
          });
          return parseUtil_js_1.INVALID;
        }
        const pairs = [];
        const keyType = this._def.keyType;
        const valueType = this._def.valueType;
        for (const key in ctx.data) {
          pairs.push({
            key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
            value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
            alwaysSet: key in ctx.data
          });
        }
        if (ctx.common.async) {
          return parseUtil_js_1.ParseStatus.mergeObjectAsync(status, pairs);
        } else {
          return parseUtil_js_1.ParseStatus.mergeObjectSync(status, pairs);
        }
      }
      get element() {
        return this._def.valueType;
      }
      static create(first, second, third) {
        if (second instanceof ZodType) {
          return new _ZodRecord({
            keyType: first,
            valueType: second,
            typeName: ZodFirstPartyTypeKind.ZodRecord,
            ...processCreateParams(third)
          });
        }
        return new _ZodRecord({
          keyType: ZodString.create(),
          valueType: first,
          typeName: ZodFirstPartyTypeKind.ZodRecord,
          ...processCreateParams(second)
        });
      }
    };
    exports.ZodRecord = ZodRecord;
    var ZodMap = class extends ZodType {
      get keySchema() {
        return this._def.keyType;
      }
      get valueSchema() {
        return this._def.valueType;
      }
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        if (ctx.parsedType !== util_js_1.ZodParsedType.map) {
          (0, parseUtil_js_1.addIssueToContext)(ctx, {
            code: ZodError_js_1.ZodIssueCode.invalid_type,
            expected: util_js_1.ZodParsedType.map,
            received: ctx.parsedType
          });
          return parseUtil_js_1.INVALID;
        }
        const keyType = this._def.keyType;
        const valueType = this._def.valueType;
        const pairs = [...ctx.data.entries()].map(([key, value], index) => {
          return {
            key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
            value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
          };
        });
        if (ctx.common.async) {
          const finalMap = /* @__PURE__ */ new Map();
          return Promise.resolve().then(async () => {
            for (const pair of pairs) {
              const key = await pair.key;
              const value = await pair.value;
              if (key.status === "aborted" || value.status === "aborted") {
                return parseUtil_js_1.INVALID;
              }
              if (key.status === "dirty" || value.status === "dirty") {
                status.dirty();
              }
              finalMap.set(key.value, value.value);
            }
            return { status: status.value, value: finalMap };
          });
        } else {
          const finalMap = /* @__PURE__ */ new Map();
          for (const pair of pairs) {
            const key = pair.key;
            const value = pair.value;
            if (key.status === "aborted" || value.status === "aborted") {
              return parseUtil_js_1.INVALID;
            }
            if (key.status === "dirty" || value.status === "dirty") {
              status.dirty();
            }
            finalMap.set(key.value, value.value);
          }
          return { status: status.value, value: finalMap };
        }
      }
    };
    exports.ZodMap = ZodMap;
    ZodMap.create = (keyType, valueType, params) => {
      return new ZodMap({
        valueType,
        keyType,
        typeName: ZodFirstPartyTypeKind.ZodMap,
        ...processCreateParams(params)
      });
    };
    var ZodSet = class _ZodSet extends ZodType {
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        if (ctx.parsedType !== util_js_1.ZodParsedType.set) {
          (0, parseUtil_js_1.addIssueToContext)(ctx, {
            code: ZodError_js_1.ZodIssueCode.invalid_type,
            expected: util_js_1.ZodParsedType.set,
            received: ctx.parsedType
          });
          return parseUtil_js_1.INVALID;
        }
        const def = this._def;
        if (def.minSize !== null) {
          if (ctx.data.size < def.minSize.value) {
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              code: ZodError_js_1.ZodIssueCode.too_small,
              minimum: def.minSize.value,
              type: "set",
              inclusive: true,
              exact: false,
              message: def.minSize.message
            });
            status.dirty();
          }
        }
        if (def.maxSize !== null) {
          if (ctx.data.size > def.maxSize.value) {
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              code: ZodError_js_1.ZodIssueCode.too_big,
              maximum: def.maxSize.value,
              type: "set",
              inclusive: true,
              exact: false,
              message: def.maxSize.message
            });
            status.dirty();
          }
        }
        const valueType = this._def.valueType;
        function finalizeSet(elements2) {
          const parsedSet = /* @__PURE__ */ new Set();
          for (const element of elements2) {
            if (element.status === "aborted")
              return parseUtil_js_1.INVALID;
            if (element.status === "dirty")
              status.dirty();
            parsedSet.add(element.value);
          }
          return { status: status.value, value: parsedSet };
        }
        const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
        if (ctx.common.async) {
          return Promise.all(elements).then((elements2) => finalizeSet(elements2));
        } else {
          return finalizeSet(elements);
        }
      }
      min(minSize, message) {
        return new _ZodSet({
          ...this._def,
          minSize: { value: minSize, message: errorUtil_js_1.errorUtil.toString(message) }
        });
      }
      max(maxSize, message) {
        return new _ZodSet({
          ...this._def,
          maxSize: { value: maxSize, message: errorUtil_js_1.errorUtil.toString(message) }
        });
      }
      size(size, message) {
        return this.min(size, message).max(size, message);
      }
      nonempty(message) {
        return this.min(1, message);
      }
    };
    exports.ZodSet = ZodSet;
    ZodSet.create = (valueType, params) => {
      return new ZodSet({
        valueType,
        minSize: null,
        maxSize: null,
        typeName: ZodFirstPartyTypeKind.ZodSet,
        ...processCreateParams(params)
      });
    };
    var ZodFunction = class _ZodFunction extends ZodType {
      constructor() {
        super(...arguments);
        this.validate = this.implement;
      }
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        if (ctx.parsedType !== util_js_1.ZodParsedType.function) {
          (0, parseUtil_js_1.addIssueToContext)(ctx, {
            code: ZodError_js_1.ZodIssueCode.invalid_type,
            expected: util_js_1.ZodParsedType.function,
            received: ctx.parsedType
          });
          return parseUtil_js_1.INVALID;
        }
        function makeArgsIssue(args, error) {
          return (0, parseUtil_js_1.makeIssue)({
            data: args,
            path: ctx.path,
            errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, (0, errors_js_1.getErrorMap)(), errors_js_1.defaultErrorMap].filter((x) => !!x),
            issueData: {
              code: ZodError_js_1.ZodIssueCode.invalid_arguments,
              argumentsError: error
            }
          });
        }
        function makeReturnsIssue(returns, error) {
          return (0, parseUtil_js_1.makeIssue)({
            data: returns,
            path: ctx.path,
            errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, (0, errors_js_1.getErrorMap)(), errors_js_1.defaultErrorMap].filter((x) => !!x),
            issueData: {
              code: ZodError_js_1.ZodIssueCode.invalid_return_type,
              returnTypeError: error
            }
          });
        }
        const params = { errorMap: ctx.common.contextualErrorMap };
        const fn = ctx.data;
        if (this._def.returns instanceof ZodPromise) {
          const me = this;
          return (0, parseUtil_js_1.OK)(async function(...args) {
            const error = new ZodError_js_1.ZodError([]);
            const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
              error.addIssue(makeArgsIssue(args, e));
              throw error;
            });
            const result = await Reflect.apply(fn, this, parsedArgs);
            const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
              error.addIssue(makeReturnsIssue(result, e));
              throw error;
            });
            return parsedReturns;
          });
        } else {
          const me = this;
          return (0, parseUtil_js_1.OK)(function(...args) {
            const parsedArgs = me._def.args.safeParse(args, params);
            if (!parsedArgs.success) {
              throw new ZodError_js_1.ZodError([makeArgsIssue(args, parsedArgs.error)]);
            }
            const result = Reflect.apply(fn, this, parsedArgs.data);
            const parsedReturns = me._def.returns.safeParse(result, params);
            if (!parsedReturns.success) {
              throw new ZodError_js_1.ZodError([makeReturnsIssue(result, parsedReturns.error)]);
            }
            return parsedReturns.data;
          });
        }
      }
      parameters() {
        return this._def.args;
      }
      returnType() {
        return this._def.returns;
      }
      args(...items) {
        return new _ZodFunction({
          ...this._def,
          args: ZodTuple.create(items).rest(ZodUnknown.create())
        });
      }
      returns(returnType) {
        return new _ZodFunction({
          ...this._def,
          returns: returnType
        });
      }
      implement(func) {
        const validatedFunc = this.parse(func);
        return validatedFunc;
      }
      strictImplement(func) {
        const validatedFunc = this.parse(func);
        return validatedFunc;
      }
      static create(args, returns, params) {
        return new _ZodFunction({
          args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
          returns: returns || ZodUnknown.create(),
          typeName: ZodFirstPartyTypeKind.ZodFunction,
          ...processCreateParams(params)
        });
      }
    };
    exports.ZodFunction = ZodFunction;
    var ZodLazy = class extends ZodType {
      get schema() {
        return this._def.getter();
      }
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        const lazySchema = this._def.getter();
        return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
      }
    };
    exports.ZodLazy = ZodLazy;
    ZodLazy.create = (getter, params) => {
      return new ZodLazy({
        getter,
        typeName: ZodFirstPartyTypeKind.ZodLazy,
        ...processCreateParams(params)
      });
    };
    var ZodLiteral = class extends ZodType {
      _parse(input) {
        if (input.data !== this._def.value) {
          const ctx = this._getOrReturnCtx(input);
          (0, parseUtil_js_1.addIssueToContext)(ctx, {
            received: ctx.data,
            code: ZodError_js_1.ZodIssueCode.invalid_literal,
            expected: this._def.value
          });
          return parseUtil_js_1.INVALID;
        }
        return { status: "valid", value: input.data };
      }
      get value() {
        return this._def.value;
      }
    };
    exports.ZodLiteral = ZodLiteral;
    ZodLiteral.create = (value, params) => {
      return new ZodLiteral({
        value,
        typeName: ZodFirstPartyTypeKind.ZodLiteral,
        ...processCreateParams(params)
      });
    };
    function createZodEnum(values, params) {
      return new ZodEnum({
        values,
        typeName: ZodFirstPartyTypeKind.ZodEnum,
        ...processCreateParams(params)
      });
    }
    var ZodEnum = class _ZodEnum extends ZodType {
      _parse(input) {
        if (typeof input.data !== "string") {
          const ctx = this._getOrReturnCtx(input);
          const expectedValues = this._def.values;
          (0, parseUtil_js_1.addIssueToContext)(ctx, {
            expected: util_js_1.util.joinValues(expectedValues),
            received: ctx.parsedType,
            code: ZodError_js_1.ZodIssueCode.invalid_type
          });
          return parseUtil_js_1.INVALID;
        }
        if (!this._cache) {
          this._cache = new Set(this._def.values);
        }
        if (!this._cache.has(input.data)) {
          const ctx = this._getOrReturnCtx(input);
          const expectedValues = this._def.values;
          (0, parseUtil_js_1.addIssueToContext)(ctx, {
            received: ctx.data,
            code: ZodError_js_1.ZodIssueCode.invalid_enum_value,
            options: expectedValues
          });
          return parseUtil_js_1.INVALID;
        }
        return (0, parseUtil_js_1.OK)(input.data);
      }
      get options() {
        return this._def.values;
      }
      get enum() {
        const enumValues = {};
        for (const val of this._def.values) {
          enumValues[val] = val;
        }
        return enumValues;
      }
      get Values() {
        const enumValues = {};
        for (const val of this._def.values) {
          enumValues[val] = val;
        }
        return enumValues;
      }
      get Enum() {
        const enumValues = {};
        for (const val of this._def.values) {
          enumValues[val] = val;
        }
        return enumValues;
      }
      extract(values, newDef = this._def) {
        return _ZodEnum.create(values, {
          ...this._def,
          ...newDef
        });
      }
      exclude(values, newDef = this._def) {
        return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
          ...this._def,
          ...newDef
        });
      }
    };
    exports.ZodEnum = ZodEnum;
    ZodEnum.create = createZodEnum;
    var ZodNativeEnum = class extends ZodType {
      _parse(input) {
        const nativeEnumValues = util_js_1.util.getValidEnumValues(this._def.values);
        const ctx = this._getOrReturnCtx(input);
        if (ctx.parsedType !== util_js_1.ZodParsedType.string && ctx.parsedType !== util_js_1.ZodParsedType.number) {
          const expectedValues = util_js_1.util.objectValues(nativeEnumValues);
          (0, parseUtil_js_1.addIssueToContext)(ctx, {
            expected: util_js_1.util.joinValues(expectedValues),
            received: ctx.parsedType,
            code: ZodError_js_1.ZodIssueCode.invalid_type
          });
          return parseUtil_js_1.INVALID;
        }
        if (!this._cache) {
          this._cache = new Set(util_js_1.util.getValidEnumValues(this._def.values));
        }
        if (!this._cache.has(input.data)) {
          const expectedValues = util_js_1.util.objectValues(nativeEnumValues);
          (0, parseUtil_js_1.addIssueToContext)(ctx, {
            received: ctx.data,
            code: ZodError_js_1.ZodIssueCode.invalid_enum_value,
            options: expectedValues
          });
          return parseUtil_js_1.INVALID;
        }
        return (0, parseUtil_js_1.OK)(input.data);
      }
      get enum() {
        return this._def.values;
      }
    };
    exports.ZodNativeEnum = ZodNativeEnum;
    ZodNativeEnum.create = (values, params) => {
      return new ZodNativeEnum({
        values,
        typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
        ...processCreateParams(params)
      });
    };
    var ZodPromise = class extends ZodType {
      unwrap() {
        return this._def.type;
      }
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        if (ctx.parsedType !== util_js_1.ZodParsedType.promise && ctx.common.async === false) {
          (0, parseUtil_js_1.addIssueToContext)(ctx, {
            code: ZodError_js_1.ZodIssueCode.invalid_type,
            expected: util_js_1.ZodParsedType.promise,
            received: ctx.parsedType
          });
          return parseUtil_js_1.INVALID;
        }
        const promisified = ctx.parsedType === util_js_1.ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
        return (0, parseUtil_js_1.OK)(promisified.then((data) => {
          return this._def.type.parseAsync(data, {
            path: ctx.path,
            errorMap: ctx.common.contextualErrorMap
          });
        }));
      }
    };
    exports.ZodPromise = ZodPromise;
    ZodPromise.create = (schema, params) => {
      return new ZodPromise({
        type: schema,
        typeName: ZodFirstPartyTypeKind.ZodPromise,
        ...processCreateParams(params)
      });
    };
    var ZodEffects = class extends ZodType {
      innerType() {
        return this._def.schema;
      }
      sourceType() {
        return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
      }
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        const effect = this._def.effect || null;
        const checkCtx = {
          addIssue: (arg) => {
            (0, parseUtil_js_1.addIssueToContext)(ctx, arg);
            if (arg.fatal) {
              status.abort();
            } else {
              status.dirty();
            }
          },
          get path() {
            return ctx.path;
          }
        };
        checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
        if (effect.type === "preprocess") {
          const processed = effect.transform(ctx.data, checkCtx);
          if (ctx.common.async) {
            return Promise.resolve(processed).then(async (processed2) => {
              if (status.value === "aborted")
                return parseUtil_js_1.INVALID;
              const result = await this._def.schema._parseAsync({
                data: processed2,
                path: ctx.path,
                parent: ctx
              });
              if (result.status === "aborted")
                return parseUtil_js_1.INVALID;
              if (result.status === "dirty")
                return (0, parseUtil_js_1.DIRTY)(result.value);
              if (status.value === "dirty")
                return (0, parseUtil_js_1.DIRTY)(result.value);
              return result;
            });
          } else {
            if (status.value === "aborted")
              return parseUtil_js_1.INVALID;
            const result = this._def.schema._parseSync({
              data: processed,
              path: ctx.path,
              parent: ctx
            });
            if (result.status === "aborted")
              return parseUtil_js_1.INVALID;
            if (result.status === "dirty")
              return (0, parseUtil_js_1.DIRTY)(result.value);
            if (status.value === "dirty")
              return (0, parseUtil_js_1.DIRTY)(result.value);
            return result;
          }
        }
        if (effect.type === "refinement") {
          const executeRefinement = (acc) => {
            const result = effect.refinement(acc, checkCtx);
            if (ctx.common.async) {
              return Promise.resolve(result);
            }
            if (result instanceof Promise) {
              throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
            }
            return acc;
          };
          if (ctx.common.async === false) {
            const inner = this._def.schema._parseSync({
              data: ctx.data,
              path: ctx.path,
              parent: ctx
            });
            if (inner.status === "aborted")
              return parseUtil_js_1.INVALID;
            if (inner.status === "dirty")
              status.dirty();
            executeRefinement(inner.value);
            return { status: status.value, value: inner.value };
          } else {
            return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
              if (inner.status === "aborted")
                return parseUtil_js_1.INVALID;
              if (inner.status === "dirty")
                status.dirty();
              return executeRefinement(inner.value).then(() => {
                return { status: status.value, value: inner.value };
              });
            });
          }
        }
        if (effect.type === "transform") {
          if (ctx.common.async === false) {
            const base = this._def.schema._parseSync({
              data: ctx.data,
              path: ctx.path,
              parent: ctx
            });
            if (!(0, parseUtil_js_1.isValid)(base))
              return parseUtil_js_1.INVALID;
            const result = effect.transform(base.value, checkCtx);
            if (result instanceof Promise) {
              throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
            }
            return { status: status.value, value: result };
          } else {
            return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
              if (!(0, parseUtil_js_1.isValid)(base))
                return parseUtil_js_1.INVALID;
              return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
                status: status.value,
                value: result
              }));
            });
          }
        }
        util_js_1.util.assertNever(effect);
      }
    };
    exports.ZodEffects = ZodEffects;
    exports.ZodTransformer = ZodEffects;
    ZodEffects.create = (schema, effect, params) => {
      return new ZodEffects({
        schema,
        typeName: ZodFirstPartyTypeKind.ZodEffects,
        effect,
        ...processCreateParams(params)
      });
    };
    ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
      return new ZodEffects({
        schema,
        effect: { type: "preprocess", transform: preprocess },
        typeName: ZodFirstPartyTypeKind.ZodEffects,
        ...processCreateParams(params)
      });
    };
    var ZodOptional = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType === util_js_1.ZodParsedType.undefined) {
          return (0, parseUtil_js_1.OK)(void 0);
        }
        return this._def.innerType._parse(input);
      }
      unwrap() {
        return this._def.innerType;
      }
    };
    exports.ZodOptional = ZodOptional;
    ZodOptional.create = (type, params) => {
      return new ZodOptional({
        innerType: type,
        typeName: ZodFirstPartyTypeKind.ZodOptional,
        ...processCreateParams(params)
      });
    };
    var ZodNullable = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType === util_js_1.ZodParsedType.null) {
          return (0, parseUtil_js_1.OK)(null);
        }
        return this._def.innerType._parse(input);
      }
      unwrap() {
        return this._def.innerType;
      }
    };
    exports.ZodNullable = ZodNullable;
    ZodNullable.create = (type, params) => {
      return new ZodNullable({
        innerType: type,
        typeName: ZodFirstPartyTypeKind.ZodNullable,
        ...processCreateParams(params)
      });
    };
    var ZodDefault = class extends ZodType {
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        let data = ctx.data;
        if (ctx.parsedType === util_js_1.ZodParsedType.undefined) {
          data = this._def.defaultValue();
        }
        return this._def.innerType._parse({
          data,
          path: ctx.path,
          parent: ctx
        });
      }
      removeDefault() {
        return this._def.innerType;
      }
    };
    exports.ZodDefault = ZodDefault;
    ZodDefault.create = (type, params) => {
      return new ZodDefault({
        innerType: type,
        typeName: ZodFirstPartyTypeKind.ZodDefault,
        defaultValue: typeof params.default === "function" ? params.default : () => params.default,
        ...processCreateParams(params)
      });
    };
    var ZodCatch = class extends ZodType {
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        const newCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          }
        };
        const result = this._def.innerType._parse({
          data: newCtx.data,
          path: newCtx.path,
          parent: {
            ...newCtx
          }
        });
        if ((0, parseUtil_js_1.isAsync)(result)) {
          return result.then((result2) => {
            return {
              status: "valid",
              value: result2.status === "valid" ? result2.value : this._def.catchValue({
                get error() {
                  return new ZodError_js_1.ZodError(newCtx.common.issues);
                },
                input: newCtx.data
              })
            };
          });
        } else {
          return {
            status: "valid",
            value: result.status === "valid" ? result.value : this._def.catchValue({
              get error() {
                return new ZodError_js_1.ZodError(newCtx.common.issues);
              },
              input: newCtx.data
            })
          };
        }
      }
      removeCatch() {
        return this._def.innerType;
      }
    };
    exports.ZodCatch = ZodCatch;
    ZodCatch.create = (type, params) => {
      return new ZodCatch({
        innerType: type,
        typeName: ZodFirstPartyTypeKind.ZodCatch,
        catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
        ...processCreateParams(params)
      });
    };
    var ZodNaN = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== util_js_1.ZodParsedType.nan) {
          const ctx = this._getOrReturnCtx(input);
          (0, parseUtil_js_1.addIssueToContext)(ctx, {
            code: ZodError_js_1.ZodIssueCode.invalid_type,
            expected: util_js_1.ZodParsedType.nan,
            received: ctx.parsedType
          });
          return parseUtil_js_1.INVALID;
        }
        return { status: "valid", value: input.data };
      }
    };
    exports.ZodNaN = ZodNaN;
    ZodNaN.create = (params) => {
      return new ZodNaN({
        typeName: ZodFirstPartyTypeKind.ZodNaN,
        ...processCreateParams(params)
      });
    };
    exports.BRAND = Symbol("zod_brand");
    var ZodBranded = class extends ZodType {
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        const data = ctx.data;
        return this._def.type._parse({
          data,
          path: ctx.path,
          parent: ctx
        });
      }
      unwrap() {
        return this._def.type;
      }
    };
    exports.ZodBranded = ZodBranded;
    var ZodPipeline = class _ZodPipeline extends ZodType {
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        if (ctx.common.async) {
          const handleAsync = async () => {
            const inResult = await this._def.in._parseAsync({
              data: ctx.data,
              path: ctx.path,
              parent: ctx
            });
            if (inResult.status === "aborted")
              return parseUtil_js_1.INVALID;
            if (inResult.status === "dirty") {
              status.dirty();
              return (0, parseUtil_js_1.DIRTY)(inResult.value);
            } else {
              return this._def.out._parseAsync({
                data: inResult.value,
                path: ctx.path,
                parent: ctx
              });
            }
          };
          return handleAsync();
        } else {
          const inResult = this._def.in._parseSync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          });
          if (inResult.status === "aborted")
            return parseUtil_js_1.INVALID;
          if (inResult.status === "dirty") {
            status.dirty();
            return {
              status: "dirty",
              value: inResult.value
            };
          } else {
            return this._def.out._parseSync({
              data: inResult.value,
              path: ctx.path,
              parent: ctx
            });
          }
        }
      }
      static create(a, b) {
        return new _ZodPipeline({
          in: a,
          out: b,
          typeName: ZodFirstPartyTypeKind.ZodPipeline
        });
      }
    };
    exports.ZodPipeline = ZodPipeline;
    var ZodReadonly = class extends ZodType {
      _parse(input) {
        const result = this._def.innerType._parse(input);
        const freeze = (data) => {
          if ((0, parseUtil_js_1.isValid)(data)) {
            data.value = Object.freeze(data.value);
          }
          return data;
        };
        return (0, parseUtil_js_1.isAsync)(result) ? result.then((data) => freeze(data)) : freeze(result);
      }
      unwrap() {
        return this._def.innerType;
      }
    };
    exports.ZodReadonly = ZodReadonly;
    ZodReadonly.create = (type, params) => {
      return new ZodReadonly({
        innerType: type,
        typeName: ZodFirstPartyTypeKind.ZodReadonly,
        ...processCreateParams(params)
      });
    };
    function cleanParams(params, data) {
      const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
      const p2 = typeof p === "string" ? { message: p } : p;
      return p2;
    }
    function custom(check, _params = {}, fatal) {
      if (check)
        return ZodAny.create().superRefine((data, ctx) => {
          const r = check(data);
          if (r instanceof Promise) {
            return r.then((r2) => {
              if (!r2) {
                const params = cleanParams(_params, data);
                const _fatal = params.fatal ?? fatal ?? true;
                ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
              }
            });
          }
          if (!r) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
          return;
        });
      return ZodAny.create();
    }
    exports.late = {
      object: ZodObject.lazycreate
    };
    var ZodFirstPartyTypeKind;
    (function(ZodFirstPartyTypeKind2) {
      ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
      ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
      ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
      ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
      ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
      ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
      ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
      ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
      ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
      ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
      ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
      ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
      ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
      ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
      ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
      ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
      ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
      ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
      ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
      ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
      ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
      ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
      ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
      ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
      ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
      ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
      ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
      ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
      ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
      ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
      ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
      ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
      ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
      ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
      ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
      ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
    })(ZodFirstPartyTypeKind || (exports.ZodFirstPartyTypeKind = ZodFirstPartyTypeKind = {}));
    var instanceOfType = (cls, params = {
      message: `Input not instance of ${cls.name}`
    }) => custom((data) => data instanceof cls, params);
    exports.instanceof = instanceOfType;
    var stringType = ZodString.create;
    exports.string = stringType;
    var numberType = ZodNumber.create;
    exports.number = numberType;
    var nanType = ZodNaN.create;
    exports.nan = nanType;
    var bigIntType = ZodBigInt.create;
    exports.bigint = bigIntType;
    var booleanType = ZodBoolean.create;
    exports.boolean = booleanType;
    var dateType = ZodDate.create;
    exports.date = dateType;
    var symbolType = ZodSymbol.create;
    exports.symbol = symbolType;
    var undefinedType = ZodUndefined.create;
    exports.undefined = undefinedType;
    var nullType = ZodNull.create;
    exports.null = nullType;
    var anyType = ZodAny.create;
    exports.any = anyType;
    var unknownType = ZodUnknown.create;
    exports.unknown = unknownType;
    var neverType = ZodNever.create;
    exports.never = neverType;
    var voidType = ZodVoid.create;
    exports.void = voidType;
    var arrayType = ZodArray.create;
    exports.array = arrayType;
    var objectType = ZodObject.create;
    exports.object = objectType;
    var strictObjectType = ZodObject.strictCreate;
    exports.strictObject = strictObjectType;
    var unionType = ZodUnion.create;
    exports.union = unionType;
    var discriminatedUnionType = ZodDiscriminatedUnion.create;
    exports.discriminatedUnion = discriminatedUnionType;
    var intersectionType = ZodIntersection.create;
    exports.intersection = intersectionType;
    var tupleType = ZodTuple.create;
    exports.tuple = tupleType;
    var recordType = ZodRecord.create;
    exports.record = recordType;
    var mapType = ZodMap.create;
    exports.map = mapType;
    var setType = ZodSet.create;
    exports.set = setType;
    var functionType = ZodFunction.create;
    exports.function = functionType;
    var lazyType = ZodLazy.create;
    exports.lazy = lazyType;
    var literalType = ZodLiteral.create;
    exports.literal = literalType;
    var enumType = ZodEnum.create;
    exports.enum = enumType;
    var nativeEnumType = ZodNativeEnum.create;
    exports.nativeEnum = nativeEnumType;
    var promiseType = ZodPromise.create;
    exports.promise = promiseType;
    var effectsType = ZodEffects.create;
    exports.effect = effectsType;
    exports.transformer = effectsType;
    var optionalType = ZodOptional.create;
    exports.optional = optionalType;
    var nullableType = ZodNullable.create;
    exports.nullable = nullableType;
    var preprocessType = ZodEffects.createWithPreprocess;
    exports.preprocess = preprocessType;
    var pipelineType = ZodPipeline.create;
    exports.pipeline = pipelineType;
    var ostring = () => stringType().optional();
    exports.ostring = ostring;
    var onumber = () => numberType().optional();
    exports.onumber = onumber;
    var oboolean = () => booleanType().optional();
    exports.oboolean = oboolean;
    exports.coerce = {
      string: ((arg) => ZodString.create({ ...arg, coerce: true })),
      number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
      boolean: ((arg) => ZodBoolean.create({
        ...arg,
        coerce: true
      })),
      bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
      date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
    };
    exports.NEVER = parseUtil_js_1.INVALID;
  }
});
var require_external = __commonJS({
  "node_modules/zod/v3/external.cjs"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    __exportStar(require_errors(), exports);
    __exportStar(require_parseUtil(), exports);
    __exportStar(require_typeAliases(), exports);
    __exportStar(require_util(), exports);
    __exportStar(require_types(), exports);
    __exportStar(require_ZodError(), exports);
  }
});
var require_zod = __commonJS({
  "node_modules/zod/index.cjs"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = exports && exports.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.z = void 0;
    var z2 = __importStar(require_external());
    exports.z = z2;
    __exportStar(require_external(), exports);
    exports.default = z2;
  }
});
function contextReview(bundle, validate) {
  const groups = { changes: [], open: [], conditions: [], decisions: [] };
  for (const source of bundle.sources) {
    let offset = 0;
    for (const line of source.text.split("\n")) {
      const start = offset;
      offset += line.length + 1;
      if (!line.trim() || line.startsWith("#")) continue;
      const c = {
        sourceId: source.id,
        title: source.title,
        hash: source.hash,
        start,
        end: start + line.length,
        firstLine: source.text.slice(0, start).split("\n").length,
        lastLine: source.text.slice(0, start).split("\n").length,
        quote: line
      };
      validate(c, bundle);
      if (/\b(changed|moved|revised|superseded|replaces|unchanged)\b/i.test(line))
        groups.changes.push(c);
      if (/\b(pending|blocked|unresolved|awaiting|not approved|not yet|open question)\b/i.test(
        line
      ))
        groups.open.push(c);
      if (/\b(if|unless|subject to|after|provided that|conditional|only when)\b/i.test(
        line
      ))
        groups.conditions.push(c);
      if (/\b(approved|agreed|decided|proposed|rejected|confirmed)\b/i.test(line))
        groups.decisions.push(c);
    }
  }
  const sourceCount = new Set(
    [...groups.open, ...groups.decisions, ...groups.conditions].map(
      (c) => c.sourceId
    )
  ).size;
  return {
    groups,
    reviewNeeded: sourceCount > 1,
    notice: "Rule-based source review signals, not a resolved timeline. Dates, authority and decision status need review. Contradictions may be missed."
  };
}
var LIMITS = {
  /** Maximum raw source size: 1 MiB. */
  maxInputBytes: 1048576,
  /** PDF upload: only the first N pages are remembered. */
  maxPdfPages: 40,
  /** Maximum JSON nesting depth. */
  maxJsonDepth: 12,
  /** Maximum number of blocks in a document. */
  maxBlocks: 100,
  /** Maximum entries in any single block collection. */
  maxEntriesPerBlock: 100,
  /** Maximum notes lines preserved per block. */
  maxNotesPerBlock: 100,
  /** Maximum length of any single imported string field. */
  maxFieldLength: 2e3,
  /** Maximum document title length. */
  maxTitleLength: 200,
  /** Maximum block title length. */
  maxBlockTitleLength: 120,
  /** Maximum provenance excerpt length (escaped, in characters). */
  maxExcerptLength: 240,
  /** Maximum source label length. */
  maxSourceLabelLength: 120,
  /** Maximum edges in the relationship graph. */
  maxRelations: 400,
  /** Words a snapshot may use before it stops reading like recall. */
  maxSnapshotWords: 120,
  /** AI request bound: 50 KiB of source text. */
  aiMaxInputBytes: 51200,
  /**
   * AI abort deadline in milliseconds.
   * Cognitive extraction (v6 phases A–E) needs more headroom than a shallow rewrite.
   */
  aiTimeoutMs: 45e3
};
var BULLET = /^\s*(?:[-*•])\s+(.*)$/;
var NUMBERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;
var TASK = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/;
function splitListItem(line) {
  const task = TASK.exec(line);
  if (task) return { marker: "task", done: task[1].toLowerCase() === "x", text: task[2].trim() };
  const bullet = BULLET.exec(line);
  if (bullet) return { marker: "bullet", text: bullet[1].trim() };
  const numbered = NUMBERED.exec(line);
  if (numbered) return { marker: "number", text: numbered[2].trim() };
  return null;
}
function splitTableRow(line) {
  if (!line.includes("|")) return null;
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  if (/^[\s:|-]+$/.test(trimmed)) return null;
  const cells = trimmed.split("|").map((c) => c.trim());
  return cells.length >= 2 && cells.some((c) => c.length > 0) ? cells : null;
}
function isTableSeparator(line) {
  if (!line.includes("|")) return false;
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.length > 0 && /^[\s:|-]+$/.test(trimmed);
}
function stripListMarker(line) {
  const item = splitListItem(line);
  return item ? item.text : line.trim();
}
var GLYPH_PREFIX = /^\s*[✓✔✅×✗✘→⇒▸▪▫◦·+]\s*/;
function stripEmphasis(text) {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/(^|\W)\*(\S(?:.*?\S)?)\*(?=\W|$)/g, "$1$2").replace(/`([^`]+)`/g, "$1").trim();
}
function plainContentOf(line) {
  return stripEmphasis(stripListMarker(line).replace(GLYPH_PREFIX, "").trim());
}
function isDecorativeLine(line) {
  const text = line.trim();
  if (text === "") return true;
  return /^[↓↑→←⇒⇓|+/\\_.·•\-–—=]{1,4}$/.test(text);
}
function isListLike(line) {
  if (splitListItem(line) !== null) return true;
  return GLYPH_PREFIX.test(line);
}
var MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
var YEAR = "(?:19|20)\\d{2}";
var DATE_ATOM = [
  // Relative words people actually write
  "(?:today|tomorrow|yesterday|tonight)",
  "(?:this|next|last)\\s+(?:week|month|quarter|year)",
  "end\\s+of\\s+(?:the\\s+)?(?:week|month|quarter|year)",
  "in\\s+\\d{1,3}\\s+(?:days?|weeks?|months?|years?)",
  // Month ranges: Jan-Jun, January – June 2026
  `${MONTH}\\.?\\s*[-\u2013\u2014]\\s*${MONTH}\\.?(?:\\s+${YEAR})?`,
  // Half-years / fiscal years
  `H[12](?:[ /]?${YEAR})?`,
  `FY\\s*'?\\d{2,4}`,
  // Calendar forms already supported
  `${MONTH}\\.?\\s+\\d{1,2}(?:,\\s*${YEAR})?`,
  `${MONTH}\\.?\\s+${YEAR}`,
  `${MONTH}\\.?`,
  `Q[1-4](?:[ /]?${YEAR})?`,
  `${YEAR}-\\d{2}-\\d{2}`,
  // Numeric month/year ("01/2024", "1-2024") before the day/month form so the
  // year is never split off as a bare-year token.
  `(?:0?[1-9]|1[0-2])[\\/-](?:19|20)\\d{2}`,
  `\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?`,
  `Week\\s+\\d{1,2}`,
  `Sprint\\s+\\d{1,2}`,
  // Bare year: 2034
  YEAR
].join("|");
var DATE_TOKEN = new RegExp(`^(${DATE_ATOM})\\b`, "i");
var DATE_EMBEDDED = [
  "(?:today|tomorrow|yesterday|tonight)",
  "(?:this|next|last)\\s+(?:week|month|quarter|year)",
  "end\\s+of\\s+(?:the\\s+)?(?:week|month|quarter|year)",
  "in\\s+\\d{1,3}\\s+(?:days?|weeks?|months?|years?)",
  `${MONTH}\\.?\\s*[-\u2013\u2014]\\s*${MONTH}\\.?(?:\\s+${YEAR})?`,
  `H[12](?:[ /]?${YEAR})?`,
  `FY\\s*'?\\d{2,4}`,
  `${MONTH}\\.?\\s+\\d{1,2}(?:,\\s*${YEAR})?`,
  `${MONTH}\\.?\\s+${YEAR}`,
  `Q[1-4](?:[ /]?${YEAR})?`,
  `${YEAR}-\\d{2}-\\d{2}`,
  // Same numeric month/year guard as DATE_ATOM: keep "01/2024" one token.
  `(?:0?[1-9]|1[0-2])[\\/-](?:19|20)\\d{2}`,
  `\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?`,
  `Week\\s+\\d{1,2}`,
  `Sprint\\s+\\d{1,2}`,
  YEAR
].join("|");
var DATE_ANYWHERE = new RegExp(`\\b(${DATE_EMBEDDED})\\b`, "i");
var DATE_ENTIRE = new RegExp(`^(?:${DATE_EMBEDDED})$`, "i");
function isEntirelyDate(text) {
  return DATE_ENTIRE.test(text.trim());
}
function looksLikeDate(text) {
  return DATE_TOKEN.test(text.trim());
}
function insideIdentifier(text, index) {
  let i = index - 1;
  while (i >= 0 && /[A-Za-z0-9]/.test(text[i])) i -= 1;
  if (i < 0 || !/[-\/_.]/.test(text[i])) return false;
  for (let j = i - 1; j >= 0 && /[A-Za-z0-9_./-]/.test(text[j]); j -= 1) {
    if (/[A-Za-z]/.test(text[j])) return true;
  }
  return false;
}
var FRACTION_UNITS = /^(?:\s+|-)(?:cups?|tsp|tbsp|teaspoons?|tablespoons?|kgs?|gms?|mg|ml|cl|litres?|liters?|oz|lbs?|pounds?|inch(?:es)?|cms?|mm|kms?|metres?|meters?|ft|feet|hours?|hrs?|minutes?|mins?|seconds?|secs?|dozen|plates?|scoops?|servings?|slices?|glasses?|packets?|bowls?|handfuls?|pinch(?:es)?|g|l|m)\b(?!\s*:)/;
function isQuantityFraction(text, index, length) {
  const token = text.slice(index, index + length);
  const parts = /^(\d{1,2})\/(\d{1,2})$/.exec(token);
  if (!parts) return false;
  const before = text.slice(0, index);
  if ((parts[2] === "5" || parts[2] === "10") && Number(parts[1]) <= Number(parts[2]) && /:\s*$/.test(before)) {
    return true;
  }
  if (Number(parts[1]) >= Number(parts[2]) || Number(parts[2]) > 16) return false;
  if (/(?:^|[^\w.\-/])\d+\s+$/.test(before)) return true;
  const after = text.slice(index + length);
  if (/^\s*%/.test(after)) return true;
  return FRACTION_UNITS.test(after);
}
function startsWithQuantityFraction(text) {
  const m = /^\d{1,2}\/\d{1,2}/.exec(text);
  return m !== null && isQuantityFraction(text, 0, m[0].length);
}
function findDateToken(text) {
  const anywhere = new RegExp(DATE_ANYWHERE.source, "gi");
  let match;
  while ((match = anywhere.exec(text)) !== null) {
    if (insideIdentifier(text, match.index)) continue;
    if (isQuantityFraction(text, match.index, match[0].length)) continue;
    if (isPhoneLikeNumber(text, match.index, match[0])) continue;
    return {
      date: match[1].replace(/\.$/, "").replace(/\s+/g, " ").trim(),
      index: match.index,
      length: match[0].length
    };
  }
  return null;
}
var BARE_YEAR = /^(?:19|20)\d{2}$/;
var PHONE_LEAD_IN = /\b(?:at|call|dial|phon(?:e|ed)|tel(?:ephone)?|helpline|contact|whatsapp)\s*$/i;
function isPhoneLikeNumber(text, index, matched) {
  if (!BARE_YEAR.test(matched)) return false;
  const before = text.slice(0, index);
  if (PHONE_LEAD_IN.test(before)) return true;
  if (/\d[\d ]$/.test(before)) return true;
  const after = text.slice(index + matched.length);
  if (/^ ?\d{2,}/.test(after)) return true;
  return false;
}
var SEPARATOR = /\s*[:—–]\s+|\s+-\s+/;
function splitOnFirstSeparator(text) {
  const match = SEPARATOR.exec(text);
  if (!match || match.index === 0) return null;
  return [text.slice(0, match.index).trim(), text.slice(match.index + match[0].length).trim()];
}
function splitTrailingKeyword(text, pattern) {
  const match = /^(.*?)\s+[—–-]\s+(\S[\s\S]{0,40}?)\.?\s*$/.exec(text);
  if (!match) return null;
  const tail = match[2].trim();
  const kw = pattern.exec(tail);
  if (!kw) return null;
  return { body: match[1].trim(), keyword: kw[0] };
}
function extractParenSuffix(text) {
  const match = /^(.*?)\s*\(([^()]{1,80})\)\s*$/.exec(text);
  if (!match) return { body: text, suffix: null };
  return { body: match[1].trim(), suffix: match[2].trim() };
}
function trendOf(text) {
  const lower = text.toLowerCase();
  if (/(^|\s)(up|grew|growth|increase|increased|▲|\+)/.test(lower)) return "up";
  if (/(^|\s)(down|fell|decline|declined|decrease|decreased|▼|-\d)/.test(lower)) return "down";
  if (/(^|\s)(flat|steady|unchanged|→|holds?)\b/.test(lower)) return "flat";
  return void 0;
}
function parseOpenQuestionLine(raw) {
  const item = splitListItem(raw);
  const text = stripEmphasis((item ? item.text : raw).trim());
  if (text.length < 12) return null;
  const looksLikeQuestion = /\?/.test(text) || /\bopen question\b/i.test(text) || /^(should|what|who|when|where|why|how)\b/i.test(text);
  if (!looksLikeQuestion) return null;
  return {
    label: "Open question",
    implication: text.replace(/^\s*open questions?\s*[:—–-]\s*/i, "").slice(0, 400)
  };
}
function parseMetricTargetLine(raw) {
  const item = splitListItem(raw);
  const text = stripEmphasis((item ? item.text : raw).trim());
  if (text.length < 12) return null;
  const targetParen = /\(target:\s*([^)]+)\)/i.exec(text);
  if (targetParen) {
    const body = text.replace(/\s*\(target:\s*[^)]+\)/i, "").trim();
    const parts = splitOnFirstSeparator(body);
    const label = (parts ? parts[0] : body).replace(/:$/, "").trim().slice(0, 120);
    const detail = parts ? parts[1] : "";
    if (label.length < 2) return null;
    return {
      label,
      value: targetParen[1].trim().slice(0, 120),
      ...detail ? { implication: detail.slice(0, 240) } : { implication: "Target" }
    };
  }
  const targetDash = /^(.{4,80}?)\s*[—–:-]\s*(.+?)\s*(?:target|goal)\s*[: ]\s*(.+)$/i.exec(text);
  if (targetDash) {
    return {
      label: targetDash[1].trim().slice(0, 120),
      value: targetDash[3].trim().slice(0, 120),
      implication: targetDash[2].trim().slice(0, 240)
    };
  }
  return null;
}
function parseSignalLine(raw) {
  const question = parseOpenQuestionLine(raw);
  if (question) return question;
  const metric = parseMetricTargetLine(raw);
  if (metric) return metric;
  const cells = splitTableRow(raw);
  if (cells && cells.length >= 2 && cells[0] && cells[1]) {
    const entry2 = { label: cells[0], value: cells[1] };
    if (cells[2]) entry2.delta = cells[2];
    const trend2 = trendOf(cells.slice(1).join(" "));
    if (trend2) entry2.trend = trend2;
    return entry2;
  }
  const item = splitListItem(raw);
  const text = item ? item.text : raw;
  const { body, suffix } = extractParenSuffix(text);
  const parts = splitOnFirstSeparator(body);
  if (!parts) return null;
  const [label, value] = parts;
  if (label.length < 1 || label.length > 60 || value.length < 1) return null;
  if (!/[0-9%$€£#<>]/.test(value)) return null;
  const entry = { label, value };
  if (suffix && /[0-9%$€£]|up|down|flat|pts?|pp\b/i.test(suffix)) entry.delta = suffix;
  const trend = trendOf(`${value} ${suffix ?? ""}`);
  if (trend) entry.trend = trend;
  return entry;
}
var DECISION_STATUS = /\b(approved|requested|proposed|rejected)\b/i;
var DECISION_COMMITMENT = /\b(committed|considered)\b/i;
var REF_TOKEN = /^([A-Z]{1,5}-\d{1,4})\s+/;
var CASES_RULE = /\b(cannot be (?:edited|reduced|removed)|no changes are allowed|removal allowed only|must not|shall not|only when|backward compatibility|cannot go below|cannot be reduced|maintain(?:s)? backward compatibility|cannot be edited)\b/i;
function parseDecisionLine(raw) {
  const priority = parsePriorityMatrixRow(raw);
  if (priority) return priority;
  const casesMatrix = parseCasesMatrixRow(raw);
  if (casesMatrix) return casesMatrix;
  const casesRule = parseCasesRuleLine(raw);
  if (casesRule) return casesRule;
  const item = splitListItem(raw);
  const text = (item ? item.text : raw).trim();
  if (text.length < 3) return null;
  if (/^(business impact|priority|feature|status|summary|overview)$/i.test(text.replace(/['"`]/g, "").trim())) {
    return null;
  }
  let rest = text;
  let ref2;
  const refMatch = REF_TOKEN.exec(rest);
  if (refMatch) {
    ref2 = refMatch[1];
    rest = rest.slice(refMatch[0].length).trim();
  }
  let status = "proposed";
  let foundStatus = false;
  let explicitCommitment;
  const { body, suffix } = extractParenSuffix(rest);
  if (suffix && DECISION_STATUS.test(suffix)) {
    status = suffix.match(DECISION_STATUS)[1].toLowerCase();
    rest = body;
    foundStatus = true;
  } else if (suffix && DECISION_COMMITMENT.test(suffix)) {
    explicitCommitment = suffix.match(DECISION_COMMITMENT)[1].toLowerCase();
    rest = body;
    foundStatus = true;
  } else {
    const trailing = splitTrailingKeyword(rest, DECISION_STATUS);
    if (trailing) {
      status = trailing.keyword.toLowerCase();
      rest = trailing.body;
      foundStatus = true;
    } else {
      const commitTrail = splitTrailingKeyword(rest, DECISION_COMMITMENT);
      if (commitTrail) {
        explicitCommitment = commitTrail.keyword.toLowerCase();
        rest = commitTrail.body;
        foundStatus = true;
      }
    }
  }
  if (!ref2 && !item && !foundStatus) return null;
  if (!ref2 && !foundStatus && rest.split(/\s+/).length < 3 && !/[.!?]$/.test(rest)) return null;
  if (rest.length < 2) return null;
  const commitment = explicitCommitment ?? (status === "approved" ? "committed" : readCommitment(rest));
  const entry = { text: rest, status, commitment };
  if (ref2) entry.ref = ref2;
  return entry;
}
function parseAcceptanceCriterionLine(raw) {
  const item = splitListItem(raw);
  if (!item) return null;
  const text = stripEmphasis(item.text.trim());
  if (text.length < 12 || text.length > 320) return null;
  if (/\?/.test(text)) return null;
  if (/^(should|what|who|when|where|why|how)\b/i.test(text)) return null;
  if (parseMetricTargetLine(raw)) return null;
  if (parseCasesRuleLine(raw)) return null;
  const procedural = /\b(display|displays|visible|auto-?increment|include|includes|available|editable|intact|trigger|triggers|preserve|amend|can amend|export|workflow|columns?|indicator|revision|pdf|permission|traceable)\b/i.test(
    text
  ) || /^(edit|revision|pdf|vendor|linked|can |display|visual|preserve|amend)/i.test(text);
  if (!procedural && text.split(/\s+/).length < 5) return null;
  if (!procedural && !/^[A-Z]/.test(text)) return null;
  return {
    text: text.slice(0, 500),
    status: "proposed",
    commitment: "committed",
    because: "Acceptance criterion"
  };
}
function parseCasesMatrixRow(raw) {
  const cells = splitTableRow(raw);
  if (cells && cells.length >= 4) {
    const field = cells[0].trim();
    const a = cells[1].trim();
    const b = cells[2].trim();
    const c = cells[3].trim();
    if (!field || /^(module|field|contract)/i.test(field)) return null;
    if (!/^[YNyN\-–.|]+$/i.test(a) || !/^[YNyN\-–.|]+$/i.test(b)) return null;
    const remarks = cells.slice(4).join(" ").trim();
    if (remarks && CASES_RULE.test(remarks)) {
      return {
        text: `${field}: ${remarks}`.slice(0, 500),
        status: "approved",
        commitment: "committed"
      };
    }
    const flags = `${a}/${b}/${c}`.replace(/\|/g, "");
    if (/^[\-–./]+$/i.test(flags) && !remarks) return null;
    return {
      text: (remarks ? `${field} [${flags}] \u2014 ${remarks}` : `${field}: editability ${flags}`).slice(0, 500),
      status: "approved",
      commitment: "committed"
    };
  }
  const item = splitListItem(raw);
  const text = stripEmphasis((item ? item.text : raw).trim());
  const prose = /^(.{3,80}?)\s+([YNyN])\s+([YNyN\-–])\s+([YNyN\-–])\s+(.+)$/.exec(text);
  if (prose) {
    const field = prose[1].trim();
    const remarks = prose[5].trim();
    if (/^(module|project|indent number)/i.test(field) && remarks.length < 8) return null;
    if (CASES_RULE.test(remarks) || remarks.length >= 12) {
      return {
        text: `${field}: ${remarks}`.slice(0, 500),
        status: "approved",
        commitment: "committed"
      };
    }
    return {
      text: `${field}: editability ${prose[2]}/${prose[3]}/${prose[4]}`.slice(0, 500),
      status: "approved",
      commitment: "committed"
    };
  }
  return null;
}
function parseCasesRuleLine(raw) {
  const item = splitListItem(raw);
  const text = stripEmphasis((item ? item.text : raw).trim());
  if (text.length < 20) return null;
  if (/^note:/i.test(text)) {
    if (!CASES_RULE.test(text)) return null;
  } else if (!CASES_RULE.test(text)) {
    return null;
  }
  if (/^[A-Za-z /&]+\s+[YNyN\-–](?:\s+[YNyN\-–]){1,3}\s*$/i.test(text)) {
    return null;
  }
  return {
    text: text.replace(/^note:\s*/i, "").slice(0, 500),
    status: "approved",
    commitment: "committed"
  };
}
function parsePriorityMatrixRow(raw) {
  const cells = splitTableRow(raw);
  if (!cells || cells.length < 2) return null;
  const priority = cells[0].trim();
  if (!/^P\d\b/i.test(priority) && !/^(critical|high|medium|low)\b/i.test(priority)) return null;
  if (/^priority$/i.test(priority)) return null;
  const feature = cells[1].trim();
  if (feature.length < 3 || /^feature$/i.test(feature)) return null;
  const impact = cells[2]?.trim();
  const text = impact ? `${priority}: ${feature} (${impact})` : `${priority}: ${feature}`;
  return {
    text,
    status: /^P0\b/i.test(priority) ? "approved" : "proposed",
    commitment: "committed",
    ref: /^P\d\b/i.exec(priority)?.[0]?.toUpperCase()
  };
}
var TIMELINE_STATE = [
  [/\b(shipped|released|launched|live)\b/i, "shipped"],
  [/\b(done|complete|completed|closed)\b/i, "done"],
  [/\b(on[\s-]?track|in\s+progress|underway)\b/i, "on-track"],
  [/\b(planned|planned|upcoming|scheduled|next|todo)\b/i, "planned"]
];
var TRAILING_STATE = /\b(shipped|released|launched|live|done|complete|completed|closed|on[\s-]?track|in\s+progress|underway|planned|upcoming|scheduled)\b/i;
var ORDINAL_DATE = /^(phase|step|stage|milestone|sprint|task|iteration)\s+([0-9]{1,3}|[a-z]|[ivxlc]+)\b/i;
var OBLIGATION_DATE_LABEL = /^(due(?:\s+date)?|dated|date|effective(?:\s+date)?|invoice\s+date|payment\s+due|as\s+of)\s*[:—–-]?\s*(.+)$/i;
var LEG_LABEL = /^(departure|arrival|depart(?:s|ing)?|arriv(?:e|es|al|ing)?)\s*[:—–-]?\s*(.+)$/i;
function titleAroundRemovedDate(text, index, length) {
  const after = text.slice(index + length);
  const rest = after.trimStart();
  const strippable = rest === "" || /^[,;.]/.test(rest) || /^(?:on|by|from|at|in|before|after|until|to|for|with)\b/i.test(rest);
  const before = strippable ? text.slice(0, index).replace(/\s+(?:on|by|from|at|in|before|after|until|to)\s*$/i, "") : text.slice(0, index);
  return `${before} ${after}`.replace(/\s+/g, " ").replace(/\s+([,;:])/g, "$1").replace(/,\s*,+/g, ",").replace(/^\s*[:—–-]\s*|\s*[:—–-]\s*$/g, "").trim();
}
function parseTimelineLine(raw) {
  const item = splitListItem(raw);
  const cells = splitTableRow(raw);
  if (cells && cells.length >= 2 && cells[0] && looksLikeDate(cells[0]) && !startsWithQuantityFraction(cells[0])) {
    const state2 = stateFromText(cells[2] ?? "") ?? "planned";
    return { date: cells[0], title: cells[1], state: state2, ...inferArtifact(cells.slice(1).join(". ")) };
  }
  if (cells && cells.length >= 2 && /^[A-Z]{2,}-\d+/i.test(cells[0])) {
    if (/^ticket$/i.test(cells[0])) return null;
    const state2 = /priorit/i.test(cells[2] ?? "") ? "planned" : stateFromText(cells[2] ?? "") ?? "planned";
    return { date: cells[0], title: cells[1], state: state2 };
  }
  const text = (item ? item.text : raw).trim();
  const obligation = parseObligationDateLine(text);
  if (obligation) return obligation;
  const leg = parseLegTimelineLine(text);
  if (leg) return leg;
  const ordinal = ORDINAL_DATE.exec(text);
  if (ordinal) {
    const marker = `${capitalizeWord(ordinal[1])} ${ordinal[2].toUpperCase()}`;
    let rest2 = text.slice(ordinal[0].length).replace(/^\s*[:—–-]\s*/, "").trim();
    let state2;
    const trailing = splitTrailingKeyword(rest2, TRAILING_STATE);
    if (trailing && trailing.keyword.length <= 24) {
      state2 = stateFromText(trailing.keyword);
      if (state2) rest2 = trailing.body;
    }
    if (!state2) state2 = stateFromText(rest2) ?? "planned";
    if (rest2.length < 2) rest2 = marker;
    return { date: marker, title: rest2, state: state2, ...inferArtifact(rest2) };
  }
  const dateMatch = DATE_TOKEN.exec(text);
  let date;
  let rest;
  if (dateMatch && !isQuantityFraction(text, 0, dateMatch[0].length)) {
    date = dateMatch[1].replace(/\.$/, "").replace(/\s+/g, " ").trim();
    rest = text.slice(dateMatch[0].length).replace(/^\s*[:—–-]\s*/, "").trim();
  } else {
    const found = findDateToken(text);
    if (!found) return null;
    date = found.date;
    rest = titleAroundRemovedDate(text, found.index, found.length);
  }
  if (rest.length < 2) return null;
  let state;
  const { body, suffix } = extractParenSuffix(rest);
  if (suffix) {
    state = stateFromText(suffix);
    if (state) rest = body;
  }
  if (!state) {
    const trailing = splitTrailingKeyword(rest, TRAILING_STATE);
    if (trailing && trailing.keyword.length <= 24) {
      state = stateFromText(trailing.keyword);
      if (state) rest = trailing.body;
    }
  }
  if (!state) state = "planned";
  return rest.length >= 2 ? { date, title: rest, state, ...inferArtifact(rest) } : null;
}
function parseObligationDateLine(text) {
  const match = OBLIGATION_DATE_LABEL.exec(text.trim());
  if (!match) return null;
  const label = match[1].trim();
  const remainder = match[2].trim();
  const found = findDateToken(remainder) ?? (looksLikeDate(remainder) && !startsWithQuantityFraction(remainder) ? { date: remainder, index: 0, length: remainder.length } : null);
  if (!found) return null;
  const title = `${label.replace(/\b\w/g, (c) => c.toUpperCase())}: ${remainder}`.slice(0, 200) || remainder;
  return {
    date: found.date,
    title,
    state: /due|payment/i.test(label) ? "planned" : "done"
  };
}
function parseLegTimelineLine(text) {
  const match = LEG_LABEL.exec(text.trim());
  if (!match) return null;
  const kind = /arriv/i.test(match[1]) ? "Arrival" : "Departure";
  const remainder = match[2].trim();
  const found = findDateToken(remainder);
  if (!found) return null;
  const after = remainder.slice(found.index + found.length);
  const time = /^\s*[·,]?\s*(\d{1,2}:\d{2})\b/.exec(after);
  const date = time ? `${found.date} ${time[1]}` : found.date;
  const title = `${kind}: ${remainder}`.replace(/\s+/g, " ").trim();
  return { date, title, state: "planned" };
}
function capitalizeWord(word) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}
function stateFromText(text) {
  for (const [pattern, state] of TIMELINE_STATE) {
    if (pattern.test(text)) return state;
  }
  return void 0;
}
var SEVERITY = /\b(high|medium|med|low)\b/i;
function parseRiskLine(raw) {
  const cells = splitTableRow(raw);
  if (cells && cells.length >= 2) {
    const sevCell = cells.findIndex((c) => SEVERITY.test(c));
    if (sevCell > 0 && cells[0]) {
      const severity2 = normalizeSeverity(cells[sevCell]);
      const mitigation2 = cells.slice(sevCell + 1).join(" \xB7 ").trim();
      if (mitigation2.length === 0) return null;
      return { ...splitReasoning(cells[0]), severity: severity2, mitigation: mitigation2 };
    }
    return null;
  }
  const item = splitListItem(raw);
  const text = (item ? item.text : raw).trim();
  const { body, suffix } = extractParenSuffix(text);
  let severity = null;
  let rest = text;
  if (suffix && SEVERITY.test(suffix)) {
    severity = normalizeSeverity(suffix);
    rest = body;
  }
  const parts = splitOnFirstSeparator(rest);
  if (!parts) return null;
  let [risk, mitigation] = parts;
  const mitigationMarker = /^mitigation\s*[:—–-]\s*/i.exec(mitigation);
  if (mitigationMarker) mitigation = mitigation.slice(mitigationMarker[0].length).trim();
  if (!severity) {
    const sevInRisk = /[[(](high|medium|med|low)[\])]/i.exec(risk);
    if (sevInRisk) {
      severity = normalizeSeverity(sevInRisk[1]);
      risk = risk.replace(sevInRisk[0], "").trim();
    }
  }
  if (!severity || risk.length < 3 || mitigation.length < 2) return null;
  return { ...splitReasoning(risk), severity, mitigation };
}
function splitReasoning(text) {
  const read = readRisk(text);
  if (!read) return { risk: text };
  return read;
}
function normalizeSeverity(text) {
  const match = SEVERITY.exec(text);
  const word = (match?.[1] ?? "medium").toLowerCase();
  return word === "med" ? "medium" : word;
}
function parseUserStoryLine(raw) {
  const item = splitListItem(raw);
  const text = stripEmphasis((item ? item.text : raw).trim());
  if (text.length < 12) return null;
  const story = /^(?:user\s*story|story)\s*[:—–-]\s*(.+)$/i.exec(text);
  if (story) {
    return {
      task: `User story: ${story[1].trim()}`.slice(0, 500),
      // Source facts from the PRD — not suggested work.
      status: "pending"
    };
  }
  const persona = /^(?:persona\s*[:—–-]\s*)?(as an?\s+.+)$/i.exec(text);
  if (persona && !/\bi want\b/i.test(text)) {
    return {
      task: `Persona: ${persona[1].trim()}`.slice(0, 240),
      status: "pending"
    };
  }
  if (/^i want\b/i.test(text) && text.length >= 20) {
    return {
      task: `User story: ${text}`.slice(0, 500),
      status: "pending"
    };
  }
  return null;
}
var TASK_HEADER_CELL = /^(tasks?|actions?|action\s+items?|task\s+items?|items?|descriptions?|task\s+descriptions?|deliverables?|steps?|activity|activities|owners?|assignees?|assigned\s+to|responsible|due(?:\s+dates?)?|deadlines?|status|amounts?|costs?|prices?|notes?)$/i;
function isTaskTableHeaderRow(raw) {
  const cells = splitTableRow(raw);
  if (!cells || cells.length < 2 || !cells[0] || !cells[1]) return false;
  return cells.slice(0, Math.min(3, cells.length)).every((c) => TASK_HEADER_CELL.test(c.trim()));
}
function remapActionEntryByHeader(entry, cells, headerCells) {
  const colIdx = (re) => headerCells.findIndex((c) => re.test(c));
  const ownerIdx = colIdx(/^(owners?|assignees?|assigned\s*to|responsible)$/);
  const dueIdx = colIdx(/^(due(\s*dates?)?|deadlines?)$/);
  const statusIdx = colIdx(/^status$/);
  const task = (cells[0] ?? "").trim();
  if (task.length < 3) return entry;
  const statusText = statusIdx >= 0 ? (cells[statusIdx] ?? "").trim() : "";
  const out = {
    ...entry,
    task,
    status: statusText ? inferReadiness(statusText) : inferReadiness(task)
  };
  delete out.owner;
  delete out.due;
  const owner = ownerIdx >= 0 ? (cells[ownerIdx] ?? "").trim() : "";
  const due = dueIdx >= 0 ? (cells[dueIdx] ?? "").trim() : "";
  if (owner) out.owner = owner;
  if (due) out.due = due;
  return out;
}
function parseActionLine(raw) {
  const story = parseUserStoryLine(raw);
  if (story) return story;
  if (isTaskTableHeaderRow(raw)) return null;
  const cells = splitTableRow(raw);
  if (cells && cells.length >= 3 && cells[0] && cells[1] && cells[2]) {
    const status2 = inferReadiness(cells.slice(3).join(" ") || cells[0]);
    return { task: cells[0], owner: cells[1], due: cells[2], status: status2 };
  }
  const item = splitListItem(raw);
  const text = (item ? item.text : raw).trim();
  if (text.length < 3) return null;
  const status = inferReadiness(text, { checked: item?.done });
  const { body, suffix } = extractParenSuffix(text);
  if (suffix && suffix.includes(",")) {
    const [owner, due] = suffix.split(",").map((s) => s.trim());
    if (owner && due && looksLikeDate(due)) {
      return { task: body, owner, due, status };
    }
  }
  const segments = text.split(/\s+[—–]\s+|\s+-\s+/).map((s) => s.trim()).filter(Boolean);
  if (segments.length >= 3) {
    const due = segments[segments.length - 1];
    const owner = segments[segments.length - 2];
    const task = segments.slice(0, -2).join(", ");
    const bareMonthOwner = /^(jan|feb|mar|apr|may|june?|july?|aug|sep|sept|oct|nov|dec)[a-z]*\.?$/i.test(owner);
    const datePrefixedOwner = /^(jan|feb|mar|apr|may|june?|july?|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}\b/i.test(owner);
    if (looksLikeDate(due) && !isEntirelyDate(owner) && !bareMonthOwner && !datePrefixedOwner && owner.length <= 60 && task.length >= 3) {
      return { task, owner, due, status };
    }
  }
  if (segments.length === 2) {
    const [task, tail] = segments;
    if (looksLikeDate(tail) && task.length >= 3) {
      return null;
    }
    const ownerMatch = /^@?([A-Z][\w.]*(?:\s+[A-Z][\w.]*){0,2})/.exec(tail);
    const dueMatch = DATE_TOKEN.exec(tail);
    if (ownerMatch && dueMatch && !isQuantityFraction(tail, 0, dueMatch[0].length) && task.length >= 3) {
      return {
        task,
        owner: ownerMatch[1],
        due: tail.slice(dueMatch.index).trim(),
        status
      };
    }
  }
  return null;
}
var MIN_ENTRY_LENGTH = 3;
var MAX_ENTRY_LENGTH = 300;
function entryText(raw) {
  const text = plainContentOf(raw);
  if (text.length < MIN_ENTRY_LENGTH || text.length > MAX_ENTRY_LENGTH) return null;
  return text;
}
function parseSignalLineLenient(raw) {
  const question = parseOpenQuestionLine(raw);
  if (question) return question;
  const metric = parseMetricTargetLine(raw);
  if (metric) return metric;
  const text = entryText(raw);
  if (!text) return null;
  const parts = splitOnFirstSeparator(text);
  if (parts) {
    const [label, value] = parts;
    if (label.length >= 1 && label.length <= 120 && value.length >= 1) {
      const entry = { label, value: value.slice(0, 120) };
      const trend = trendOf(value);
      if (trend) entry.trend = trend;
      return entry;
    }
  }
  return { label: text.slice(0, 120) };
}
function parseSignalSalvage(raw) {
  return parseOpenQuestionLine(raw) ?? parseMetricTargetLine(raw) ?? parseSignalLine(raw);
}
function parseDecisionLineLenient(raw) {
  const cases = parseCasesRuleLine(raw) ?? parseCasesMatrixRow(raw);
  if (cases) return cases;
  const requirement = parseAcceptanceCriterionLine(raw);
  if (requirement) return requirement;
  const strict = parseDecisionLine(raw);
  if (strict) return strict;
  const text = entryText(raw);
  if (!text) return null;
  if (/^(business impact|priority|feature|status|summary|overview)$/i.test(text)) return null;
  if (!splitListItem(raw)) return null;
  if (text.split(/\s+/).length < 2) return null;
  return { text, status: "proposed", commitment: readCommitment(text) };
}
function parseTimelineLineLenient(raw) {
  const text = entryText(raw);
  if (!text) return null;
  const strict = parseTimelineLine(raw);
  if (strict) return strict;
  const found = findDateToken(text);
  if (!found) return null;
  const title = `${text.slice(0, found.index)} ${text.slice(found.index + found.length)}`.replace(/\s+/g, " ").replace(/^\s*[:—–-]\s*|\s*[:—–-]\s*$/g, "").trim();
  if (title.length < 2) return null;
  return {
    date: found.date,
    title,
    state: stateFromText(text) ?? "planned",
    ...inferArtifact(title)
  };
}
function parseRiskLineLenient(raw) {
  const text = entryText(raw);
  if (!text) return null;
  const strict = parseRiskLine(raw);
  if (strict) return strict;
  return splitReasoning(text);
}
function parseActionLineLenient(raw) {
  const story = parseUserStoryLine(raw);
  if (story) return story;
  if (isTaskTableHeaderRow(raw)) return null;
  const text = entryText(raw);
  if (!text) return null;
  const strict = parseActionLine(raw);
  if (strict) return strict;
  const item = splitListItem(raw);
  const entry = { task: text, status: inferReadiness(text, { checked: item?.done }) };
  const dueMatch = DATE_TOKEN.exec(text);
  if (dueMatch && !isQuantityFraction(text, 0, dueMatch[0].length)) entry.due = dueMatch[1].replace(/\.$/, "");
  return entry;
}
var HEADING_KEYWORDS = {
  // snapshot — what this document is
  snapshot: "snapshot",
  summary: "snapshot",
  overview: "snapshot",
  brief: "snapshot",
  about: "snapshot",
  introduction: "snapshot",
  intro: "snapshot",
  abstract: "snapshot",
  objective: "snapshot",
  objectives: "snapshot",
  goal: "snapshot",
  goals: "snapshot",
  purpose: "snapshot",
  scope: "snapshot",
  context: "snapshot",
  "business context": "snapshot",
  background: "snapshot",
  mission: "snapshot",
  vision: "snapshot",
  premise: "snapshot",
  // signals — indicators, measured or qualitative
  signals: "signals",
  metrics: "signals",
  "key metrics": "signals",
  "success metrics": "signals",
  "adoption metrics": "signals",
  "efficiency metrics": "signals",
  "quality metrics": "signals",
  kpis: "signals",
  kpi: "signals",
  numbers: "signals",
  highlights: "signals",
  stats: "signals",
  statistics: "signals",
  // "Results" → timeline storage (research Results furniture); PRD outcomes stay below.
  results: "timeline",
  outcomes: "signals",
  targets: "signals",
  benchmarks: "signals",
  criteria: "signals",
  "success criteria": "signals",
  "definition of done": "signals",
  measurements: "signals",
  "frequency of issues": "signals",
  // Acceptance criteria are procedural requirements → Decisions, not prose notes.
  "acceptance criteria": "decisions",
  // decisions — rules, positions, things settled
  decisions: "decisions",
  decided: "decisions",
  "decision log": "decisions",
  "design decisions": "decisions",
  rules: "decisions",
  "implementation rules": "decisions",
  "ground rules": "decisions",
  principles: "decisions",
  guidelines: "decisions",
  conventions: "decisions",
  standards: "decisions",
  policy: "decisions",
  policies: "decisions",
  constraints: "decisions",
  requirements: "decisions",
  "key requirements": "decisions",
  priority: "decisions",
  "priority matrix": "decisions",
  "priority & impact matrix": "decisions",
  "impact matrix": "decisions",
  "cases - sheet": "decisions",
  "cases sheet": "decisions",
  "cases sheet embedded spreadsheet": "decisions",
  "embedded spreadsheet": "decisions",
  "editability rules": "decisions",
  "editability rules recovered from spreadsheet": "decisions",
  philosophy: "decisions",
  tradeoffs: "decisions",
  "trade-offs": "decisions",
  "non-goals": "decisions",
  // timeline — ordered delivery / dated itinerary / obligation dates
  timeline: "timeline",
  roadmap: "timeline",
  milestones: "timeline",
  schedule: "timeline",
  dates: "timeline",
  phases: "timeline",
  plan: "timeline",
  releases: "timeline",
  sprints: "timeline",
  iterations: "timeline",
  stages: "timeline",
  itinerary: "timeline",
  "flight itinerary": "timeline",
  "travel itinerary": "timeline",
  "boarding pass": "timeline",
  "due dates": "timeline",
  deadlines: "timeline",
  "ticket breakdown": "timeline",
  "ticket breakdown by theme": "timeline",
  "po edit history & audit trail": "timeline",
  "po amendment after approval/grn": "timeline",
  "other module edit capabilities": "timeline",
  // risks — what could go wrong
  risks: "risks",
  "risk register": "risks",
  concerns: "risks",
  threats: "risks",
  blockers: "risks",
  issues: "risks",
  challenges: "risks",
  pitfalls: "risks",
  caveats: "risks",
  limitations: "risks",
  "known issues": "risks",
  "failure modes": "risks",
  problem: "risks",
  "problem statement": "risks",
  "business impact": "risks",
  "pain points": "risks",
  "current pain points": "risks",
  // Open questions are unresolved signals — not risks and not decisions.
  "open questions": "signals",
  questions: "signals",
  "unresolved questions": "signals",
  // actions — work to do
  actions: "actions",
  "action items": "actions",
  tasks: "actions",
  todos: "actions",
  "to-dos": "actions",
  "to do": "actions",
  "next steps": "actions",
  "follow-ups": "actions",
  "follow ups": "actions",
  workflow: "actions",
  "implementation workflow": "actions",
  steps: "actions",
  deliverables: "actions",
  backlog: "actions",
  checklist: "actions",
  "user stories": "actions",
  "user stories & acceptance criteria": "actions",
  // Resume / CV — route into universal kinds; UI labels come from projection.
  education: "decisions",
  "education history": "decisions",
  certifications: "decisions",
  "work experience": "timeline",
  experience: "timeline",
  employment: "timeline",
  "professional experience": "timeline",
  skills: "signals",
  "technical skills": "signals",
  competencies: "signals",
  projects: "actions",
  "side projects": "actions",
  portfolio: "actions",
  achievements: "risks",
  awards: "risks",
  honors: "risks",
  "career highlights": "risks",
  "key achievements": "risks",
  // Invoice / receipt → Vendor / Line items / Payment / Timeline / Totals
  vendor: "decisions",
  "bill to": "decisions",
  "sold to": "decisions",
  "line items": "signals",
  items: "signals",
  charges: "signals",
  payment: "actions",
  "payment instructions": "actions",
  "how to pay": "actions",
  remittance: "actions",
  totals: "risks",
  subtotal: "risks",
  "amount due": "risks",
  "grand total": "risks",
  tax: "risks",
  payments: "timeline",
  "payment schedule": "timeline",
  "due date": "timeline",
  "issue date": "timeline",
  // Research paper → Research Question / Key Findings / Evidence / Insights / …
  // (Research world-model also reads section roles directly; these route leftovers.)
  hypothesis: "snapshot",
  "research question": "snapshot",
  methodology: "signals",
  methods: "signals",
  method: "signals",
  "experimental setup": "signals",
  evaluation: "timeline",
  findings: "timeline",
  "key findings": "timeline",
  evidence: "signals",
  insights: "decisions",
  "future work": "actions",
  "further work": "actions",
  "future research": "actions",
  "future directions": "actions",
  conclusion: "decisions",
  conclusions: "decisions",
  // Meeting notes / research discussion → Insights under research furniture
  discussion: "decisions",
  agenda: "timeline",
  attendees: "snapshot",
  "meeting notes": "snapshot"
};
var MAX_KEYWORD_WORDS = 8;
function matchHeading(line, nextLine) {
  const atx = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
  if (atx) return { text: atx[2].trim(), level: atx[1].length };
  if (nextLine !== void 0 && /^\s{0,3}(=+|-+)\s*$/.test(nextLine) && line.trim().length > 0) {
    return { text: line.trim(), level: nextLine.trim().startsWith("=") ? 1 : 2 };
  }
  const plain = line.trim().replace(/:$/, "").trim();
  if (plain.length > 0 && plain.length <= 40 && !/[.!?]$/.test(plain)) {
    const words = plain.toLowerCase().split(/\s+/);
    if (words.length <= MAX_KEYWORD_WORDS && HEADING_KEYWORDS[words.join(" ")]) {
      return { text: plain, level: 2 };
    }
  }
  return null;
}
function classifyHeading(text) {
  const normalized = text.toLowerCase().replace(/^\d+(\.\d+)*\.?\s*/, "").replace(/^(slide|deck|page|section)\s+\d+\s*[-—–:.]?\s*/i, "").replace(/\s*\(.*\)\s*$/, "").replace(/:$/, "").replace(/[—–]/g, "-").replace(/\s*-\s*/g, " - ").replace(/\s+/g, " ").trim();
  const compact = normalized.replace(/\s*-\s*/g, " ").replace(/\s+/g, " ").trim();
  const direct = HEADING_KEYWORDS[normalized] ?? HEADING_KEYWORDS[compact];
  if (direct) return direct;
  const keywords = Object.entries(HEADING_KEYWORDS).sort((a, b) => b[0].length - a[0].length);
  for (const [keyword, kind] of keywords) {
    if (normalized === keyword || compact === keyword) return kind;
    if (normalized.startsWith(keyword + " ") || normalized.endsWith(" " + keyword)) return kind;
    if (normalized.includes(" " + keyword + " ")) return kind;
    if (compact.startsWith(keyword + " ") || compact.endsWith(" " + keyword)) return kind;
    if (compact.includes(" " + keyword + " ")) return kind;
  }
  if (/^as an?\s+/i.test(normalized)) return "actions";
  return null;
}
function kindClaimedByHeading(headingText) {
  if (!headingText) return null;
  return classifyHeading(headingText);
}
var ORDINAL_HEADING = /^(phase|task|step|stage|milestone|sprint|iteration|week|day|part|chapter)\s+([0-9]{1,3}|[a-z]|[ivxlc]+)\b/i;
function matchOrdinalHeading(text) {
  const match = ORDINAL_HEADING.exec(text.trim());
  if (!match) return null;
  const marker = `${capitalize(match[1])} ${match[2].toUpperCase()}`;
  const rest = text.trim().slice(match[0].length).replace(/^\s*[:—–-]\s*/, "").trim();
  return { marker, rest };
}
function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}
var RULE_LINE = /^(never|always|do not|don't|dont|avoid|prefer|must|should|only|keep|use|ensure|require|no\b)/i;
var RISK_LINE = /\b(risk|risky|fail|failure|danger|threat|blocker|breaks?|broken|degrad|outage|vulnerab|unsafe|bottleneck)\b/i;
var MEASURED = /[0-9]+\s*(%|pts?|pp\b|ms\b|s\b|x\b|k\b|m\b|bn?\b)|[$€£]\s*[0-9]|[0-9]+\s*(hours?|days?|weeks?|months?)/i;
function shapeOf(lines) {
  const shape = { total: 0, rules: 0, risks: 0, measured: 0, numbered: 0, bulleted: 0, tasks: 0 };
  for (const raw of lines) {
    const text = raw.trim();
    if (text === "") continue;
    shape.total++;
    const item = splitListItem(raw);
    const body = item ? item.text : text;
    if (item?.marker === "number") shape.numbered++;
    if (item?.marker === "bullet" || item?.marker === "task") shape.bulleted++;
    if (item?.marker === "task") shape.tasks++;
    if (RULE_LINE.test(body)) shape.rules++;
    if (RISK_LINE.test(body)) shape.risks++;
    if (MEASURED.test(body)) shape.measured++;
  }
  return shape;
}
function inferKindFromLines(lines) {
  const shape = shapeOf(lines);
  if (shape.total < 2) return null;
  const ratio = (n) => n / shape.total;
  const taskRatio = ratio(shape.tasks);
  if (taskRatio >= 0.5) {
    const competing = Math.max(
      ratio(shape.risks),
      ratio(shape.measured),
      ratio(shape.rules),
      ratio(shape.numbered)
    );
    if (taskRatio >= competing) return "actions";
  }
  if (ratio(shape.risks) >= 0.4) return "risks";
  if (ratio(shape.measured) >= 0.5) return "signals";
  if (ratio(shape.rules) >= 0.5) return "decisions";
  if (ratio(shape.numbered) >= 0.6) return "actions";
  return null;
}
function isStructuralLine(line) {
  const trimmed = line.trim();
  if (trimmed === "") return false;
  if (/^(=+|-{3,}|\*{3,}|_{3,})$/.test(trimmed)) return true;
  if (/^```/.test(trimmed)) return true;
  if (/^<!--\s*(page|image):/i.test(trimmed)) return true;
  return false;
}
var STOPWORDS = /* @__PURE__ */ new Set([
  "a",
  "about",
  "above",
  "across",
  "after",
  "again",
  "against",
  "all",
  "almost",
  "also",
  "although",
  "always",
  "among",
  "an",
  "and",
  "another",
  "any",
  "anything",
  "are",
  "around",
  "as",
  "at",
  "back",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "best",
  "better",
  "between",
  "both",
  "but",
  "by",
  "came",
  "can",
  "cannot",
  "come",
  "could",
  "did",
  "do",
  "does",
  "doing",
  "done",
  "down",
  "during",
  "each",
  "either",
  "else",
  "enough",
  "even",
  "ever",
  "every",
  "few",
  "for",
  "from",
  "further",
  "get",
  "gets",
  "give",
  "go",
  "goes",
  "going",
  "good",
  "got",
  "had",
  "has",
  "have",
  "having",
  "he",
  "her",
  "here",
  "hers",
  "him",
  "his",
  "how",
  "however",
  "i",
  "if",
  "in",
  "including",
  "instead",
  "into",
  "is",
  "it",
  "its",
  "itself",
  "just",
  "keep",
  "kind",
  "know",
  "least",
  "less",
  "let",
  "like",
  "little",
  "long",
  "made",
  "make",
  "makes",
  "making",
  "many",
  "may",
  "me",
  "might",
  "more",
  "most",
  "much",
  "must",
  "my",
  "need",
  "needs",
  "never",
  "new",
  "next",
  "no",
  "nor",
  "not",
  "now",
  "of",
  "off",
  "often",
  "on",
  "once",
  "one",
  "only",
  "onto",
  "or",
  "other",
  "others",
  "our",
  "out",
  "over",
  "own",
  "per",
  "put",
  "rather",
  "really",
  "same",
  "see",
  "seen",
  "several",
  "shall",
  "she",
  "should",
  "since",
  "so",
  "some",
  "something",
  "still",
  "such",
  "sure",
  "take",
  "takes",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "thing",
  "things",
  "this",
  "those",
  "though",
  "through",
  "thus",
  "to",
  "too",
  "toward",
  "under",
  "until",
  "up",
  "upon",
  "us",
  "use",
  "used",
  "uses",
  "using",
  "very",
  "want",
  "was",
  "way",
  "we",
  "well",
  "were",
  "what",
  "when",
  "where",
  "whether",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "within",
  "without",
  "would",
  "yet",
  "you",
  "your"
]);
function isStopword(word) {
  return STOPWORDS.has(word.toLowerCase());
}
function tokenize(text) {
  return text.toLowerCase().replace(/['’]s\b/g, "").split(/[^a-z0-9+#.]+/).map((t) => t.replace(/^\.+|\.+$/g, "")).filter((t) => t.length > 0);
}
function contentTokens(text) {
  return tokenize(text).filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}
var SUFFIXES = ["ations", "ation", "ingly", "ising", "izing", "ings", "ing", "edly", "ed", "ies", "ies", "es", "s", "ly", "ments", "ment", "ness"];
function stem(word) {
  let out = word.toLowerCase();
  if (out.length <= 4) return out;
  for (const suffix of SUFFIXES) {
    if (out.length - suffix.length >= 3 && out.endsWith(suffix)) {
      out = out.slice(0, -suffix.length);
      break;
    }
  }
  return out.endsWith("e") && out.length > 4 ? out.slice(0, -1) : out;
}
function stemTokens(text) {
  return contentTokens(text).map(stem);
}
function normalizeKey(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function wordCount(text) {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}
var ABBREVIATIONS = /\b(?:e\.g|i\.e|etc|vs|approx|fig|no|mr|mrs|ms|dr|prof|inc|ltd|co|st|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.$/i;
function splitSentences(text) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat === "") return [];
  const out = [];
  let buffer = "";
  const parts = flat.split(/(?<=[.!?])\s+/);
  for (const part of parts) {
    buffer = buffer === "" ? part : `${buffer} ${part}`;
    if (ABBREVIATIONS.test(buffer) || /\d\.$/.test(buffer)) continue;
    out.push(buffer.trim());
    buffer = "";
  }
  if (buffer.trim() !== "") out.push(buffer.trim());
  return out.filter((s) => s.length > 0);
}
function overlap(a, b) {
  const left = new Set(contentTokens(a));
  const right = new Set(contentTokens(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  return shared / (left.size + right.size - shared);
}
function numberMultiset(text) {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, "")).sort().join("\0");
}
function saysTheSame(a, b) {
  if (normalizeKey(a) === normalizeKey(b)) return true;
  const na = numberMultiset(a);
  const nb = numberMultiset(b);
  if (na !== "" && nb !== "" && na !== nb) return false;
  return overlap(a, b) >= 0.72;
}
function dedupeByMeaning(items, textOf) {
  const kept = [];
  const keptPrepared = [];
  const keys = /* @__PURE__ */ new Set();
  const byNumbers = /* @__PURE__ */ new Map();
  const withoutNumbers = [];
  for (const item of items) {
    const text = textOf(item);
    if (text.trim() === "") continue;
    const prepared = prepareMeaning(text);
    if (keys.has(prepared.key)) continue;
    const candidates = prepared.numbers === "" ? keptPrepared : [...withoutNumbers, ...byNumbers.get(prepared.numbers) ?? []];
    if (candidates.some((k) => samePrepared(k, prepared))) continue;
    kept.push(item);
    keptPrepared.push(prepared);
    keys.add(prepared.key);
    if (prepared.numbers === "") withoutNumbers.push(prepared);
    else {
      const group = byNumbers.get(prepared.numbers) ?? [];
      group.push(prepared);
      byNumbers.set(prepared.numbers, group);
    }
  }
  return kept;
}
function prepareMeaning(text) {
  return { key: normalizeKey(text), numbers: numberMultiset(text), tokens: new Set(contentTokens(text)) };
}
function samePrepared(a, b) {
  if (a.key === b.key) return true;
  if (a.numbers !== "" && b.numbers !== "" && a.numbers !== b.numbers) return false;
  if (a.tokens.size === 0 || b.tokens.size === 0) return false;
  let shared = 0;
  for (const token of a.tokens) if (b.tokens.has(token)) shared++;
  return shared / (a.tokens.size + b.tokens.size - shared) >= 0.72;
}
function normalizeDecisionText(text) {
  return text.toLowerCase().replace(/[''`]/g, "").replace(/\b(po|indent|grn)\s+list\s+views?\b/g, "list view").replace(/\blist\s+views?\b/g, "list view").replace(/\bauto-?increments?\b/g, "auto increment").replace(/\brevision\s+numbers?\b/g, "revision number").replace(/\bwith each edit\b/g, "").replace(/\bremain(?:s)? intact\b/g, "preserve").replace(/\bpreserve[sd]?\b/g, "preserve").replace(/\blinked advances\b/g, "linked advance").replace(/\bapproval workflows?\b/g, "approval workflow").replace(/\bconfigurable\b/g, "").replace(/\bvisible in\b/g, "visible").replace(/\bshows?\b/g, "show").replace(/\bincludes?\b/g, "include").replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
var DECISION_ANCHORS = [
  "edited on",
  "edited by",
  "revision number",
  "auto increment",
  "linked advance",
  "approval workflow",
  "edit history",
  "visual indicator",
  "pdf export",
  "editor name",
  "edit button",
  "amend po",
  "grn creation"
];
function sameDecision(a, b) {
  if (saysTheSame(a, b)) return true;
  const na = normalizeDecisionText(a);
  const nb = normalizeDecisionText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) {
    const shorter = na.length <= nb.length ? na : nb;
    if (contentTokens(shorter).length >= 3) return true;
  }
  const left = new Set(stemTokens(na));
  const right = new Set(stemTokens(nb));
  if (left.size === 0 || right.size === 0) return false;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  const ratio = shared / Math.min(left.size, right.size);
  if (shared >= 3 && ratio >= 0.62) return true;
  const aAnchors = DECISION_ANCHORS.filter((p) => na.includes(p));
  const bAnchors = DECISION_ANCHORS.filter((p) => nb.includes(p));
  const sharedAnchors = aAnchors.filter((p) => bAnchors.includes(p));
  if (sharedAnchors.length === 0) return false;
  const aOnly = aAnchors.filter((p) => !bAnchors.includes(p));
  const bOnly = bAnchors.filter((p) => !aAnchors.includes(p));
  if (aOnly.length > 0 && bOnly.length > 0) return false;
  return shared >= 2 && ratio >= 0.45;
}
function isDecisionChrome(text) {
  const key = normalizeKey(text);
  if (!key) return true;
  if (/^(business impact|priority|feature|status|module|field|remarks?|rules?|note|summary|overview|context)$/i.test(
    key
  )) {
    return true;
  }
  if (/^(po|grn|indent)\s*:\s*(delivery|payable|fulfilled)/i.test(key)) return true;
  return false;
}
function clampWords(text, maxWords) {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(" ").replace(/[,;:]$/, "") + "...";
}
function shorten(text, maxWords) {
  const trimmed = unpunctuated(text);
  const words = trimmed.split(/\s+/);
  if (words.length <= maxWords) return trimmed;
  const head = words.slice(0, maxWords).join(" ");
  const breakAt = Math.max(head.lastIndexOf(","), head.lastIndexOf(" - "), head.lastIndexOf(";"));
  let out = breakAt > head.length * 0.5 ? head.slice(0, breakAt) : head;
  while (out.split(/\s+/).length > 2 && readsAsFragment(out)) {
    out = out.split(/\s+/).slice(0, -1).join(" ");
  }
  return unpunctuated(out);
}
var SPELLED = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve"
];
function spellCount(n) {
  return SPELLED[n] ?? String(n);
}
function sentenceCase(text) {
  const trimmed = text.trim();
  if (trimmed === "") return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}
function unpunctuated(text) {
  return text.trim().replace(/[.;,]+$/, "").trim();
}
function decapitalize(text) {
  const trimmed = text.trim();
  const first = trimmed.split(/\s+/)[0] ?? "";
  if (first.length > 1 && first === first.toUpperCase()) return trimmed;
  if (/^[A-Z][a-z]+[A-Z]/.test(first)) return trimmed;
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}
var DANGLING = /\b(?:a|an|the|to|of|for|with|in|on|at|by|from|and|or|but|is|are|was|were|be|been|that|this|which|as|into|than|then|so|its|their|our|your|it)$/i;
function readsAsFragment(text) {
  const trimmed = unpunctuated(text);
  if (trimmed === "") return true;
  if (wordCount(trimmed) < 2) return true;
  return DANGLING.test(trimmed);
}
function speakList(items) {
  const clean = items.map((i) => i.trim()).filter((i) => i.length > 0);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  return `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`;
}
var MAX_PHRASE_WORDS = 3;
var MIN_SPREAD_FOR_THEME = 2;
var META_TERMS = /* @__PURE__ */ new Set([
  "appendix",
  "chapter",
  "checklist",
  "column",
  "content",
  "context",
  "deliverable",
  "detail",
  "details",
  "diagram",
  "document",
  "documentation",
  "example",
  "examples",
  "figure",
  "goal",
  "goals",
  "heading",
  "implementation",
  "input",
  "inputs",
  "item",
  "items",
  "list",
  "note",
  "notes",
  "objective",
  "objectives",
  "outline",
  "output",
  "outputs",
  "overview",
  "page",
  "paragraph",
  "part",
  "phase",
  "phases",
  "point",
  "points",
  "process",
  "purpose",
  "requirement",
  "requirements",
  "result",
  "results",
  "scope",
  "section",
  "sections",
  "stage",
  "stages",
  "step",
  "steps",
  "structure",
  "summary",
  "table",
  "task",
  "tasks",
  "template",
  "version",
  "work"
]);
function extractConcepts(input, limit = 12) {
  const counts = /* @__PURE__ */ new Map();
  const heads = new Heads();
  const record = (phrase, sectionIndex, boost = 1) => {
    const key = normalizeKey(phrase);
    if (key.length < 3) return;
    const existing = counts.get(key);
    if (existing) {
      existing.count += boost;
      existing.sections.add(sectionIndex);
      return;
    }
    counts.set(key, { display: phrase.trim(), count: boost, sections: /* @__PURE__ */ new Set([sectionIndex]) });
  };
  input.sections.forEach((lines, sectionIndex) => {
    for (const line of lines) {
      heads.read(line);
      for (const phrase of candidatePhrases(line)) record(phrase, sectionIndex);
    }
  });
  input.headings.forEach((heading, index) => {
    heads.read(heading);
    for (const phrase of candidatePhrases(heading)) record(phrase, index, 3);
  });
  const concepts = [];
  for (const entry of counts.values()) {
    const spread = entry.sections.size;
    if (entry.count < 2 && spread < MIN_SPREAD_FOR_THEME) continue;
    if (heads.endsMidName(entry.display)) continue;
    const words = entry.display.trim().split(/\s+/).length;
    concepts.push({
      phrase: entry.display,
      count: entry.count,
      spread,
      weight: entry.count * Math.max(1, spread) * (1 + 0.6 * (words - 1))
    });
  }
  concepts.sort((a, b) => b.weight - a.weight || b.spread - a.spread || a.phrase.localeCompare(b.phrase));
  return dropContainedPhrases(concepts).slice(0, limit);
}
var Heads = class {
  free = /* @__PURE__ */ new Map();
  followers = /* @__PURE__ */ new Map();
  read(line) {
    const words = tokenize(line);
    words.forEach((word, index) => {
      const next = words[index + 1];
      const leansOnNext = next !== void 0 && next.length >= 3 && !isStopword(next) && !/^\d/.test(next);
      if (!leansOnNext) {
        this.free.set(word, (this.free.get(word) ?? 0) + 1);
        return;
      }
      const seen = this.followers.get(word) ?? /* @__PURE__ */ new Set();
      seen.add(stem(next));
      this.followers.set(word, seen);
    });
  }
  /**
   * True when a phrase stops on a word that never closes one.
   *
   * For a single word this catches the modifier itself ("dual"). For a run it
   * catches a window that opened in the right place and shut in the wrong one:
   * "Series B data" is three words of "Series B data room", and the giveaway
   * is that "data" is never the last thing said.
   *
   * The follower count is what keeps this from eating real terms. "Data" is
   * followed by "room" and nothing else, so the pair is one name and half of
   * it is meaningless. "Analytics" is followed by a launch, a tier and a
   * price, so it is a subject that happens to take modifiers, and dropping it
   * would lose the thing the document is most about.
   */
  endsMidName(phrase) {
    const words = normalizeKey(phrase).split(" ");
    const last = words[words.length - 1] ?? "";
    if ((this.free.get(last) ?? 0) > 0) return false;
    return (this.followers.get(last)?.size ?? 0) === 1;
  }
};
function candidatePhrases(line) {
  const words = tokenize(line);
  if (words.length === 0) return [];
  const out = [];
  for (const word of words) {
    if (word.length < 4 || isStopword(word) || META_TERMS.has(word)) continue;
    if (/^\d/.test(word)) continue;
    out.push(word);
  }
  for (let size = 2; size <= MAX_PHRASE_WORDS; size++) {
    for (let i = 0; i + size <= words.length; i++) {
      const run = words.slice(i, i + size);
      const first = run[0];
      const last = run[run.length - 1];
      if (isStopword(first) || isStopword(last)) continue;
      if (first.length < 3 || last.length < 3) continue;
      if (size > 1 && /[a-z]{2}ed$/.test(last)) continue;
      if (run.some((w) => /^\d+$/.test(w))) continue;
      if (run.join("").length < 8) continue;
      if (run.every((w) => META_TERMS.has(w) || isStopword(w))) continue;
      out.push(run.join(" "));
    }
  }
  return out;
}
function dropContainedPhrases(concepts) {
  const kept = [];
  const keptForms = [];
  for (const concept of concepts) {
    const key = ` ${normalizeKey(concept.phrase)} `;
    const words = new Set(stemTokens(concept.phrase));
    const swallowed = keptForms.some((k) => {
      if (k.key === key || k.key.includes(key) || key.includes(k.key)) return true;
      return k.stems.filter((w) => words.has(w)).length >= 2;
    });
    if (!swallowed) {
      kept.push(concept);
      keptForms.push({ key, stems: stemTokens(concept.phrase) });
    }
  }
  return kept;
}
function conceptsIn(sentence, concepts) {
  const key = normalizeKey(sentence);
  return concepts.filter((c) => key.includes(normalizeKey(c.phrase)));
}
function labelFor(sentence, concepts, maxWords = 6) {
  const matched = conceptsIn(sentence, concepts)[0];
  if (matched) return matched.phrase;
  return shorten(sentence, maxWords);
}
function obligationDateConfidence(text) {
  const line = text.trim();
  const obligation = parseObligationDateLine(line);
  if (!obligation) {
    if (/^due(?:\s+date)?$/i.test(line)) return "none";
    return "none";
  }
  const date = obligation.date.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(date)) return "high";
  if (looksLikeDate(date) && findDateToken(date)) return "medium";
  if (/^(soon|eventually|asap|tbd|tba)$/i.test(date)) return "none";
  return "low";
}
function shouldProjectInvoiceDueToTimeline(text) {
  const conf = obligationDateConfidence(text);
  return conf === "high" || conf === "medium";
}
function projectSingleLegTimeline(entries) {
  const departures = entries.filter((e) => /\bdepart/i.test(e.title));
  const arrivals = entries.filter((e) => /\barriv/i.test(e.title));
  const ordered = [];
  if (departures[0]) ordered.push(departures[0]);
  if (arrivals[0]) ordered.push(arrivals[0]);
  if (ordered.length < 2) {
    for (const entry of entries) {
      if (ordered.includes(entry)) continue;
      if (/\b(depart|arriv)/i.test(entry.title) && ordered.length < 2) {
        ordered.push(entry);
      }
    }
  }
  return ordered.slice(0, 2);
}
function harvestSingleLegLine(text) {
  return parseLegTimelineLine(text);
}
var ACTION_SHAPE = /^(?:[-*•]\s*)?(?:\[[ xX]?\]\s*)?(?:spec|implement|draft|chase|sign|ship|build|write|run|send|add|fix|create|update|deploy)\b/i;
var ACTION_META = /\b(@?\w[\w.\s]{0,40})\s*[—–-]\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d)/i;
var RISK_SHAPE = /\b(risk|blocker|blocked|mitigation|exposure|compliance gap|failure|threat)\b/i;
var REQUIREMENT_SHAPE = /\b(must|shall|required|mandatory|non-negotiable|acceptance criteria|every\s+\w+\s+must)\b/i;
var PHASE_SHAPE = /^(?:phase|step|stage|milestone)\s+\d+/i;
function strongestCategory(text) {
  const t = text.trim();
  if (!t) return null;
  if (PHASE_SHAPE.test(t)) return "requirement";
  if (RISK_SHAPE.test(t) && /\bmitigation\b|\(high\)|\(medium\)|\(low\)/i.test(t)) return "risk";
  if (RISK_SHAPE.test(t) && !REQUIREMENT_SHAPE.test(t)) return "risk";
  if (ACTION_SHAPE.test(t) || ACTION_META.test(t)) return "action";
  if (REQUIREMENT_SHAPE.test(t)) return "requirement";
  return null;
}
function blocksDecisionInference(text) {
  const t = text.trim();
  if (!t) return false;
  if (PHASE_SHAPE.test(t)) return true;
  const strong = strongestCategory(text);
  return strong === "risk" || strong === "action";
}
var EXPLICIT_COMMITMENT = /\b(we (?:have )?(?:decided|approved|chose|chosen|committed|agreed)|decision\s*[:—-]|approved\b|committed to|will ship|will adopt|we're going with|we are going with)\b/i;
function hasExplicitCommitmentVerb(text) {
  return EXPLICIT_COMMITMENT.test(text);
}
function isProblemStatement(text, sectionTitle) {
  if (sectionTitle && /\b(problem|open questions?|pain points?)\b/i.test(sectionTitle)) return true;
  if (/\bcannot\b|\bcan't\b|\bunable to\b|\bfail(?:s|ed|ing)? to\b/i.test(text) && !hasExplicitCommitmentVerb(text)) {
    return true;
  }
  return false;
}
function allowSlideDecision(text, sectionTitle) {
  if (isProblemStatement(text, sectionTitle)) return false;
  return hasExplicitCommitmentVerb(text);
}
function isInvoiceArchetype(archetype) {
  return archetype === "invoice";
}
var CONDITIONAL = [
  /^if\s+(.{6,160}?),?\s+then\s+(.{4,200})$/i,
  /^if\s+(.{6,160}?),\s+(.{6,200})$/i,
  /^when(?:ever)?\s+(.{6,160}?),\s+(.{6,200})$/i,
  /^(.{6,160}?)\s+(?:usually |often |generally )?means\s+(?:that\s+)?(.{4,200})$/i,
  /^(.{6,160}?),\s+which\s+(?:means|signals|indicates|tells you)\s+(?:that\s+)?(.{4,200})$/i
];
var COMPARISON = [
  /^(.{4,140}?)\s+(?:consistently\s+)?(?:beat|beats|outperform|outperforms|outperformed|win|wins against|works better than|work better than|is better than|are better than|is more effective than|are more effective than|matters more than|matter more than)\s+(.{3,160})$/i,
  /^(?:prefer|favour|favor|choose|pick)\s+(.{3,140}?)\s+(?:over|rather than|instead of)\s+(.{3,160})$/i,
  /^(.{4,140}?)\s+(?:rather than|instead of)\s+(.{3,160})$/i
];
var CAUSE_FORWARD = /^(.{6,160}?)\s+(?:leads to|lead to|results in|result in|causes|cause|drives|drive|produces|produce|creates|create|triggers|trigger|unlocks|unlock)\s+(.{4,200})$/i;
var CAUSE_BACKWARD = /^(.{6,160}?)\s+(?:because|since|as)\s+(.{6,200})$/i;
var LESSON = /^(?:the\s+)?(?:key|trick|point|lesson|takeaway|insight|rule of thumb|most important (?:rule|thing|part)|whole point|real \w+)\b|^remember\b|^note that\b|^in practice\b|\bwhat (?:really )?matters(?: most)? is\b|\bthe difference (?:is|comes from)\b/i;
var CONTRAST = /^(.{8,160}?),?\s+(?:but|yet|however|although|though|while)\s+(.{6,200})$/i;
var UP = /\b(high|higher|up|rising|rose|grew|growth|increase[ds]?|strong|more|surge|spike|improv)\w*\b/i;
var DOWN = /\b(low|lower|down|falling|fell|drop(?:ped|ping)?|decline[ds]?|weak|fewer|less|poor|slow)\w*\b/i;
function inferSignals(statements, concepts) {
  const collected = [];
  const out = {
    push(candidate) {
      const { label, implication, trend } = candidate.value;
      if (readsAsFragment(label)) return;
      if (implication !== void 0 && readsAsFragment(implication)) {
        collected.push({ ...candidate, value: { label, ...trend ? { trend } : {} } });
        return;
      }
      collected.push(candidate);
    }
  };
  for (const statement of statements) {
    const text = unpunctuated(statement.text);
    if (wordCount(text) < 4) continue;
    const conditional = firstMatch(text, CONDITIONAL);
    if (conditional) {
      out.push({
        value: {
          label: sentenceCase(clampWords(unpunctuated(conditional[1]), 14)),
          implication: sentenceCase(clampWords(unpunctuated(conditional[2]), 20))
        },
        evidence: statement
      });
      continue;
    }
    const comparison = firstMatch(text, COMPARISON);
    if (comparison) {
      const winner = unpunctuated(comparison[1]);
      const loser = unpunctuated(comparison[2]);
      out.push({
        value: {
          label: sentenceCase(clampWords(winner, 12)),
          implication: `Preferred over ${decapitalize(clampWords(loser, 12))}`
        },
        evidence: statement
      });
      continue;
    }
    const forward = CAUSE_FORWARD.exec(text);
    if (forward) {
      out.push({
        value: {
          label: sentenceCase(clampWords(unpunctuated(forward[1]), 14)),
          implication: sentenceCase(clampWords(unpunctuated(forward[2]), 18)),
          ...directionOf(text)
        },
        evidence: statement
      });
      continue;
    }
    const backward = CAUSE_BACKWARD.exec(text);
    if (backward && wordCount(backward[2]) >= 3) {
      out.push({
        value: {
          label: sentenceCase(clampWords(unpunctuated(backward[2]), 14)),
          implication: sentenceCase(clampWords(unpunctuated(backward[1]), 18))
        },
        evidence: statement
      });
      continue;
    }
    const contrast = CONTRAST.exec(text);
    if (contrast && bothSidesDirectional(contrast[1], contrast[2])) {
      out.push({
        value: {
          label: sentenceCase(clampWords(unpunctuated(contrast[1]), 12)),
          implication: `But ${decapitalize(clampWords(unpunctuated(contrast[2]), 16))}`,
          ...directionOf(contrast[2])
        },
        evidence: statement
      });
      continue;
    }
    if (LESSON.test(text) && wordCount(text) >= 5) {
      const label = labelFor(text, concepts, 8);
      out.push({
        value: {
          label: sentenceCase(label || clampWords(text, 10)),
          implication: sentenceCase(clampWords(text, 24))
        },
        evidence: statement
      });
    }
  }
  return collected;
}
function bothSidesDirectional(left, right) {
  const leftUp = UP.test(left);
  const leftDown = DOWN.test(left);
  const rightUp = UP.test(right);
  const rightDown = DOWN.test(right);
  if (!(leftUp || leftDown) || !(rightUp || rightDown)) return false;
  return leftUp && rightDown || leftDown && rightUp;
}
function directionOf(text) {
  const up = UP.test(text);
  const down = DOWN.test(text);
  if (up && !down) return { trend: "up" };
  if (down && !up) return { trend: "down" };
  return {};
}
var COMMITTED = /^(?:we|i|the team)\s+(?:will|won't|will not|are going to|'re going to|am going to|have decided|decided|chose|choose|are using|use|are adopting|adopt|are standardi[sz]ing|standardi[sz]e)\b|^decision\s*[:—-]|^(?:always|never|do not|don't|dont)\b|\b(?:must|shall|is required to|are required to|required|cannot|can't|need to|needs to)\b|\bwe(?:'|’)?re going with\b|\bthe rule is\b|\bnon-negotiable\b/i;
var REQUIREMENT_RULE = /\b(edit history|audit trail|revision number|approval workflow|amend|editable|traceable|auto-increment|edited on|edited by)\b/i;
var CONSIDERED = /\b(?:could|might|may want to|consider|perhaps|maybe|one option|another option|optionally|if you (?:like|prefer|want)|worth (?:trying|considering)|possibly|it (?:can|may) help|you can also|feel free to|ideally)\b/i;
var IMPERATIVE = /^(use|build|create|write|run|start|open|clean|check|add|remove|keep|make|set|pick|choose|avoid|prefer|ensure|define|split|group|send|ship|test|map|draft|treat|store|apply|focus|begin|repeat|validate|verify|export|document|measure|track|break|combine|separate|standardi[sz]e|expand|reduce|extend|move|migrate|adopt|retire|replace|enforce|restrict|allow|require|drop|cache|batch|isolate|centrali[sz]e|deprecate)\b/i;
var RATIONALE = /\b(?:so that|so as to|in order to|to avoid|to prevent|because|since|which keeps|which avoids|which prevents)\s+(.{4,160})$/i;
var VERDICT_HEADING = /^(the\s+)?(verdict|bottom\s+line|our\s+take|final\s+word|should\s+you\s+buy)\b/i;
var OPEN_QUESTION = /^(?:(?:open questions?|tbd|to be (?:decided|determined))\b|(?:unresolved|undecided)\s*(?:[:\-–—?]|$))/i;
function readCommitment(text) {
  if (CONSIDERED.test(text)) return "considered";
  if (COMMITTED.test(text)) return "committed";
  return IMPERATIVE.test(text.trim()) ? "committed" : "considered";
}
function inferDecisions(statements, intent, _archetype) {
  const out = [];
  const prescriptive = intent.kind === "guide" || intent.kind === "spec" || intent.instructional;
  for (const statement of statements) {
    const claimed = kindClaimedByHeading(statement.sectionTitle);
    if (claimed && claimed !== "decisions" && claimed !== "snapshot") continue;
    if (statement.sectionTitle && VERDICT_HEADING.test(statement.sectionTitle)) continue;
    if (statement.task) continue;
    const text = unpunctuated(statement.text);
    if (OPEN_QUESTION.test(text)) continue;
    if (wordCount(text) < 3) continue;
    if (blocksDecisionInference(text)) continue;
    if (isProblemStatement(text, statement.sectionTitle)) {
      if (!allowSlideDecision(text, statement.sectionTitle)) continue;
    }
    const considered = CONSIDERED.test(text);
    const committed = COMMITTED.test(text);
    const imperative = prescriptive && statement.listItem && IMPERATIVE.test(text);
    const requirement = statement.listItem && REQUIREMENT_RULE.test(text) && (prescriptive || /\b(requirement|criteria|scope|audit|amend|history)\b/i.test(statement.sectionTitle ?? ""));
    if (!committed && !considered && !imperative && !requirement) continue;
    const commitment = considered ? "considered" : "committed";
    const rationale = RATIONALE.exec(text);
    const reason = rationale ? sentenceCase(clampWords(unpunctuated(rationale[1]), 18)) : void 0;
    const because = reason && !readsAsFragment(reason) ? reason : void 0;
    const body = rationale ? unpunctuated(text.slice(0, rationale.index)) : text;
    if (wordCount(body) < 3) continue;
    const settled = sentenceCase(clampWords(body, 30));
    if (readsAsFragment(settled)) continue;
    out.push({
      value: {
        text: settled,
        commitment,
        ...because ? { because } : {}
      },
      evidence: statement
    });
  }
  return out;
}
var TROUBLE = /\b(risk|risky|fail|fails|failure|danger|dangerous|threat|blocker|blocked|breaks?|broken|degrad\w*|outage|vulnerab\w*|unsafe|bottleneck|slip|slipped|delay\w*|shortfall|gap|miss\w*|wasted?|waste|lose|lost|losing|churn|overrun|exposure|weak\w*|poor|insufficient|unclear|conflict|error|bug|debt|stall\w*|hurt|damage|penal\w*)\b/i;
var CONSEQUENCE = /\b(?:leading to|leads to|lead to|resulting in|results in|result in|which (?:means|costs|wastes|delays|blocks)|so you(?:'|’)?ll|so we(?:'|’)?ll|you end up|we end up|ends up|at the cost of|costing|risking|and (?:you|we) (?:lose|waste|miss))\s+(.{4,180})$/i;
var WHY = /\b(?:because|since|which (?:signals|indicates|suggests|points to)|a sign(?:al)? of|usually means|typically means|driven by|caused by|due to)\s+(.{4,180})/i;
var DIAGNOSTIC = /^(.{8,160}?),?\s+(?:but|yet|however|while|with)\s+(.{6,180})$/i;
var TOPICAL = /\b(covers?|covering|discuss(?:es|ed|ing)?|talks?\s+about|writes?\s+about|writing\s+about|speaks?\s+about|presents?(?:ing)?|explains?(?:ing)?|describ\w+|teach(?:es|ing)?|taught|explor\w+|reviews?(?:ing)?|summariz\w+|overviews?)\b/i;
function readRisk(text) {
  const flat = unpunctuated(text);
  if (wordCount(flat) < 4) return null;
  const consequenceMatch = CONSEQUENCE.exec(flat);
  const whyMatch = WHY.exec(flat);
  const diagnostic2 = DIAGNOSTIC.exec(flat);
  if (!TROUBLE.test(flat) && !consequenceMatch) return null;
  if (!consequenceMatch) {
    const troubleHit = TROUBLE.exec(flat);
    const topicalHit = TOPICAL.exec(flat);
    if (troubleHit && topicalHit && topicalHit.index < troubleHit.index) return null;
  }
  let observation = flat;
  let consequence;
  let because;
  if (consequenceMatch) {
    observation = unpunctuated(flat.slice(0, consequenceMatch.index));
    consequence = sentenceCase(clampWords(unpunctuated(consequenceMatch[1]), 18));
  }
  if (whyMatch && whyMatch.index > 0) {
    const reason = sentenceCase(clampWords(unpunctuated(whyMatch[1]), 18));
    if (!consequence || reason !== consequence) because = reason;
    if (!consequenceMatch) observation = unpunctuated(flat.slice(0, whyMatch.index));
  }
  if (!because && diagnostic2 && TROUBLE.test(diagnostic2[2])) {
    observation = sentenceCase(clampWords(unpunctuated(diagnostic2[1]), 14));
    because = sentenceCase(clampWords(unpunctuated(diagnostic2[2]), 16));
  }
  observation = observation.replace(
    /^(?:there is|there's|we have|we see|this is)\s+(?:a\s+)?(?:risk|danger|chance)\s+(?:that|of)\s+/i,
    ""
  );
  if (wordCount(observation) < 3) return null;
  const stated = sentenceCase(clampWords(observation, 26));
  if (readsAsFragment(stated)) return null;
  return {
    risk: stated,
    ...because && !readsAsFragment(because) ? { because } : {},
    ...consequence && !readsAsFragment(consequence) ? { consequence } : {}
  };
}
function inferRisks(statements) {
  const out = [];
  for (const statement of statements) {
    const claimed = kindClaimedByHeading(statement.sectionTitle);
    if (claimed && claimed !== "risks" && claimed !== "snapshot") continue;
    const value = readRisk(statement.text);
    if (value) out.push({ value, evidence: statement });
  }
  return out;
}
var PRODUCES = (
  // Colon forms first so "output: x" is not captured as ": x" by `outputs?`;
  // the (?![a-z]) boundary stops "delivery"/"producer" matching `deliver`/`produce`.
  /\b(?:(?:deliverables?|outputs?|artifacts?)(?![a-z])\s*[:—-]|(?:produces?|produced|outputs?|delivers?|yields?|creates?|results? in|you(?:'|’)?ll have|leaves you with|ends with)(?![a-z]))\s*(?:a|an|the)?\s*(.{3,120}?)(?:[.;]|$)/i
);
var REQUIRES = /\b(?:(?:required before|needed before|must happen before|depends on|dependent on|blocked by|prerequisites?|requires?|after you have|once you have|only after)(?![a-z])\s*[:—-]?)\s*(?:a|an|the)?\s*(.{3,120}?)(?:[.;]|$)/i;
function inferArtifact(text) {
  const artifact = {};
  const produces = PRODUCES.exec(text);
  if (produces) artifact.produces = sentenceCase(clampWords(unpunctuated(produces[1]), 10));
  const requires = REQUIRES.exec(text);
  if (requires) artifact.requires = sentenceCase(clampWords(unpunctuated(requires[1]), 10));
  return artifact;
}
var FINISHED = /\b(done|complete|completed|closed|shipped|delivered|finished|landed)\b/i;
var ACCOMPLISHED_WORDS = new Set(
  "delivered built improved reached awarded increased reduced flagged took preserved launched led drove achieved won created designed developed ran grew raised earned ranked placed published mentored automated eliminated lifted benchmarked implemented introduced spearheaded orchestrated migrated streamlined scaled negotiated secured co-founded founded established executed made gained attained exceeded surpassed generated saved accelerated modernized refactored optimized optimised organized organised taught trained presented authored co-authored coordinated managed directed owned maintained rewrote revamped deployed released piloted tested validated analyzed analysed researched evaluated diagnosed identified resolved solved fixed documented added changed removed dropped deprecated upgraded downgraded bumped reverted".split(" ")
);
var FIRST_WORD = /^([\w-]+)/i;
var PAST_CONTEXT = /\b(last\s+(?:week|month|quarter|year|sprint)|past\s+(?:week|month|quarter|year)|ago|yesterday)\b/i;
var IN_YEAR = /\bin\s+(20\d\d)\b/;
function hasPastContext(text) {
  if (PAST_CONTEXT.test(text)) return true;
  const year = IN_YEAR.exec(text)?.[1];
  return year !== void 0 && Number.parseInt(year, 10) < (/* @__PURE__ */ new Date()).getFullYear();
}
function leadsWithAccomplishedVerb(text) {
  const first = FIRST_WORD.exec(text)?.[1]?.toLowerCase();
  if (first === "cut") return hasPastContext(text);
  if (first && ACCOMPLISHED_WORDS.has(first)) return true;
  const two = /^([\w-]+\s+[\w-]+)/i.exec(text)?.[1]?.toLowerCase().replace(/\s+/g, " ");
  return two === "rolled out";
}
var READY = /\b(ready|ready to (?:go|start|ship)|good to go|unblocked|approved to start|cleared)\b/i;
function inferReadiness(text, options = {}) {
  if (options.checked === true) return "done";
  if (FINISHED.test(text)) return "done";
  if (leadsWithAccomplishedVerb(text.trim())) return "done";
  if (READY.test(text)) return "ready";
  if (CONSIDERED.test(text)) return "suggested";
  return "pending";
}
function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return match;
  }
  return null;
}
var BOLD_LEAD = /^\s*\*\*[^*]+\*\*/;
var MONTH_NAME = /(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)/i;
var MONTH_INDEX = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12
};
function findDateRange(text) {
  const first = findDateToken(text);
  if (!first) return null;
  const twoMonths = new RegExp(
    `^(${MONTH_NAME.source})\\.?\\s*[-\u2013\u2014]\\s*(${MONTH_NAME.source})\\.?(\\s+(?:19|20)\\d{2})?$`,
    "i"
  ).exec(first.date);
  if (twoMonths) {
    const year = twoMonths[3]?.trim() ?? "";
    return {
      start: `${twoMonths[1]}${year ? ` ${year}` : ""}`,
      end: `${twoMonths[2]}${year ? ` ${year}` : ""}`,
      index: first.index,
      length: first.length
    };
  }
  const rest = text.slice(first.index + first.length);
  const joiner = /^\s*[-–—]\s*/.exec(rest);
  if (!joiner) return null;
  const tail = rest.slice(joiner[0].length);
  const openEnded = /^(present|current|now|ongoing)(?=\s*[.,;:!?)\]]*\s*(?:[|·(].*)?$)/i.exec(tail.trim());
  const openEnd = openEnded?.[1];
  if (openEnd) {
    return {
      start: first.date,
      end: openEnd,
      index: first.index,
      length: first.length + joiner[0].length + tail.indexOf(openEnd) + openEnd.length,
      open: true
    };
  }
  const second = findDateToken(tail) ?? (/^\d{4}\b/.test(tail.trim()) ? { date: tail.trim().slice(0, 4), index: tail.indexOf(tail.trim().slice(0, 4)), length: 4 } : null);
  if (!second) return null;
  return {
    start: first.date,
    end: second.date,
    index: first.index,
    length: first.length + joiner[0].length + second.index + second.length
  };
}
function toYearMonth(date) {
  const iso = /^(\d{4})-(\d{2})/.exec(date.trim());
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]) };
  const monthYear = new RegExp(`^(${MONTH_NAME.source})\\.?\\s+((?:19|20)\\d{2})$`, "i").exec(
    date.trim()
  );
  if (monthYear) {
    const month = MONTH_INDEX[monthYear[1].toLowerCase().replace(/\.$/, "").slice(0, 3)];
    return month ? { year: Number(monthYear[2]), month } : null;
  }
  const numericMonthYear = /^(0?[1-9]|1[0-2])[\/-]((?:19|20)\d{2})$/.exec(date.trim());
  if (numericMonthYear) {
    return { year: Number(numericMonthYear[2]), month: Number(numericMonthYear[1]) };
  }
  const bareYear = /^((?:19|20)\d{2})$/.exec(date.trim());
  if (bareYear) return { year: Number(bareYear[1]), month: 12 };
  return null;
}
function isPastRange(range, now = /* @__PURE__ */ new Date()) {
  const end = toYearMonth(range.end);
  if (!end) return false;
  const current = { year: now.getFullYear(), month: now.getMonth() + 1 };
  return end.year < current.year || end.year === current.year && end.month < current.month;
}
var MONTH_WORD = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;
var COMPLETION_LABEL = /^\s*\*\*\s*(done|completed?|shipped|landed|finished|released|launched)\s*\*\*\s*[:.—–-]?\s*$/i;
function isCompletionLabelLine(text) {
  return COMPLETION_LABEL.test(text);
}
var READINESS_LABEL = /^\s*\*\*\s*ready\s*\*\*\s*[:.—–-]?\s*$/i;
function isReadinessLabelLine(text) {
  return READINESS_LABEL.test(text);
}
var GROUP_LABEL = /^\s*\*\*\s*(?:(?:this|last|next)\s+(?:week|month|quarter|year|sprint)|today|tomorrow|later|someday|backlog|todo|to-do|doing|in progress|ongoing|done|completed|up next|next up|blocked|pending|ready|in[ -]review|on[ -]hold|waiting|stalled|paused|wip)\s*\*\*\s*[:.—–-]?\s*$/i;
function isTitleCandidate(text, next) {
  if (isListLike(text) || isDecorativeLine(text) || isTableSeparator(text) || splitTableRow(text)) {
    return false;
  }
  if (!next || !isListLike(next.text)) return false;
  if (BOLD_LEAD.test(text) && !GROUP_LABEL.test(text) && !isCompletionLabelLine(text)) return true;
  if (!/[0-9]/.test(text) && !MONTH_WORD.test(text)) return false;
  const plain = plainContentOf(text);
  if (plain.length < 2 || plain.length > 200) return false;
  return findDateRange(plain) !== null;
}
function detectEntityGroups(lines) {
  const groups = [];
  let hasList = false;
  let hasNonList = false;
  for (const l of lines) {
    if (isListLike(l.text)) hasList = true;
    else if (l.text.trim() !== "") hasNonList = true;
    if (hasList && hasNonList) break;
  }
  if (!hasList || !hasNonList) return groups;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!isTitleCandidate(line.text, lines[i + 1])) {
      i++;
      continue;
    }
    const detailLines = [];
    let j = i + 1;
    while (j < lines.length && isListLike(lines[j].text)) {
      detailLines.push(lines[j]);
      j++;
    }
    groups.push({ titleLine: line, detailLines });
    i = j;
  }
  return groups;
}
function groupLineNumbers(group) {
  return [group.titleLine.lineNo, ...group.detailLines.map((l) => l.lineNo)];
}
function detailsOf(group) {
  return group.detailLines.map((l) => plainContentOf(l.text)).filter((d) => d.length > 0).slice(0, LIMITS.maxEntriesPerBlock);
}
function buildActionFromGroup(group, now = /* @__PURE__ */ new Date()) {
  const task = plainContentOf(group.titleLine.text).slice(0, LIMITS.maxFieldLength);
  const details = detailsOf(group);
  const range = findDateRange(task);
  const items = group.detailLines.map((l) => splitListItem(l.text));
  const boxes = items.filter((i) => i?.marker === "task");
  const allBoxesChecked = boxes.length > 0 && boxes.length === items.length && boxes.every((i) => i.done);
  const anyBoxUnchecked = boxes.some((i) => i.done === false);
  let status = inferReadiness(task);
  if (range && isPastRange(range, now)) {
    status = "done";
  } else if (
    // An explicit "Present"/"Current" says the entity is still active; that is
    // stronger evidence than past-tense detail lines are of finished work.
    !range?.open && status === "pending" && !anyBoxUnchecked && details.length > 0 && details.every((d) => inferReadiness(d) === "done")
  ) {
    status = "done";
  }
  if (allBoxesChecked) status = "done";
  if (range?.open) status = "pending";
  return {
    task,
    status,
    ...details.length > 0 ? { details } : {}
  };
}
function buildTimelineFromGroup(group, now = /* @__PURE__ */ new Date()) {
  const plain = plainContentOf(group.titleLine.text);
  const range = findDateRange(plain);
  const single = range ? null : findDateToken(plain);
  if (!range && !single) return null;
  const date = (range ? range.start : single.date).slice(0, 80);
  const rawSpan = range ?? { index: single.index, length: single.length };
  let spanStart = rawSpan.index;
  let spanEnd = rawSpan.index + rawSpan.length;
  const openParen = /\(\s*$/.exec(plain.slice(0, spanStart));
  const closeParen = /^\s*\)/.exec(plain.slice(spanEnd));
  if (openParen && closeParen) {
    spanStart -= openParen[0].length;
    spanEnd += closeParen[0].length;
  }
  const terminalDot = /^\s*\.(?=\s|$)/.exec(plain.slice(spanEnd));
  if (terminalDot) spanEnd += terminalDot[0].length;
  const span = { index: spanStart, length: spanEnd - spanStart };
  let title = `${plain.slice(0, span.index)} ${plain.slice(span.index + span.length)}`.replace(/\s+/g, " ").replace(/^[\s,;·:—–-]+|[\s,;·:—–-]+$/g, "").trim();
  if (!/[A-Za-z0-9]/.test(title) || title.length < 2 && !/[A-Za-z]/.test(title)) title = plain;
  const past = range ? isPastRange(range, now) : (() => {
    const end = toYearMonth(single.date);
    if (!end) return false;
    const current = { year: now.getFullYear(), month: now.getMonth() + 1 };
    return end.year < current.year || end.year === current.year && end.month < current.month;
  })();
  const details = detailsOf(group);
  return {
    date,
    title: title.slice(0, LIMITS.maxFieldLength),
    state: past ? "done" : "planned",
    ...details.length > 0 ? { details } : {}
  };
}
function ok(value, warnings = []) {
  return { ok: true, value, warnings };
}
var LINK_THRESHOLD = 0.2;
var MIN_SHARED_TOKENS = 2;
var MAX_EDGES_PER_MEMORY = 2;
function buildRelations(blocks) {
  const signals = entriesOf(blocks, "signals");
  const decisions = entriesOf(blocks, "decisions");
  const timeline = entriesOf(blocks, "timeline");
  const risks = entriesOf(blocks, "risks");
  const actions = entriesOf(blocks, "actions");
  const relations = [];
  if (blocks.some((b) => b.kind === "snapshot")) {
    for (const kind of ["signals", "decisions", "timeline", "risks", "actions"]) {
      const block = blocks.find((b) => b.kind === kind);
      if (block && countOf(block) > 0) {
        relations.push({ from: "snapshot", to: kind, relation: "frames" });
      }
    }
  }
  const openQuestions = signals.filter((s) => /^open questions?$/i.test(s.entry.label));
  const measured = signals.filter(
    (s) => s.entry.value !== void 0 && !/^open questions?$/i.test(s.entry.label)
  );
  const otherSignals = signals.filter(
    (s) => s.entry.value === void 0 && !/^open questions?$/i.test(s.entry.label)
  );
  relations.push(
    ...link(openQuestions, decisions, "blocks", signalText, (d) => d.text, "unresolved before deciding")
  );
  relations.push(
    ...link(decisions, openQuestions, "depends_on", (d) => d.text, signalText, "waits on this question")
  );
  relations.push(
    ...link(measured, decisions, "supports", signalText, (d) => d.text, "backs this requirement")
  );
  relations.push(
    ...link(otherSignals, decisions, "motivates", signalText, (d) => d.text, "drives this choice")
  );
  relations.push(...link(signals, risks, "threatens", signalText, (r) => riskText(r), "shows up as"));
  relations.push(
    ...link(risks, decisions, "motivates", (r) => riskText(r), (d) => d.text, "creates the need")
  );
  relations.push(
    ...link(decisions, risks, "mitigates", (d) => d.text, (r) => riskText(r), "addresses this risk")
  );
  relations.push(...linkActionsToDecisions(actions, decisions));
  relations.push(
    ...link(timeline, actions, "schedules", (t) => `${t.title} ${t.produces ?? ""}`, (a) => a.task, "lands in")
  );
  relations.push(...linkPhaseDependencies(timeline));
  return dedupe(relations).slice(0, LIMITS.maxRelations);
}
function entriesOf(blocks, kind) {
  const block = blocks.find((b) => b.kind === kind);
  if (!block || !("entries" in block.payload)) return [];
  return block.payload.entries.map((entry, index) => ({ kind, index, entry }));
}
function countOf(block) {
  if ("entries" in block.payload) return block.payload.entries.length;
  return 1;
}
function ref(kind, index) {
  return `${kind}:${index}`;
}
function signalText(entry) {
  return [entry.label, entry.value, entry.implication].filter(Boolean).join(" ");
}
function riskText(entry) {
  return [entry.risk, entry.because, entry.consequence].filter(Boolean).join(" ");
}
function relatedness(a, b) {
  const left = new Set(stemTokens(a));
  const right = new Set(stemTokens(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  if (shared < MIN_SHARED_TOKENS) return 0;
  return shared / Math.min(left.size, right.size);
}
function link(from, to, relation, textOfA, textOfB, note) {
  const out = [];
  if (from.length === 0 || to.length === 0) return out;
  const targets = to.map((target) => ({ target, tokens: new Set(stemTokens(textOfB(target.entry))) }));
  for (const source of from) {
    const left = new Set(stemTokens(textOfA(source.entry)));
    const scored = targets.map(({ target, tokens: right }) => {
      let shared = 0;
      for (const token of left) if (right.has(token)) shared++;
      const score = left.size && right.size && shared >= MIN_SHARED_TOKENS ? shared / Math.min(left.size, right.size) : 0;
      return { target, score };
    }).filter((s) => s.score >= LINK_THRESHOLD).sort((a, b) => b.score - a.score).slice(0, MAX_EDGES_PER_MEMORY);
    for (const { target } of scored) {
      out.push({
        from: ref(source.kind, source.index),
        to: ref(target.kind, target.index),
        relation,
        note
      });
    }
  }
  return out;
}
function linkActionsToDecisions(actions, decisions) {
  const out = [];
  for (const action of actions) {
    const stated = action.entry.from;
    if (stated) {
      const key = normalizeKey(stated);
      const exact = decisions.find(
        (d) => d.entry.ref && normalizeKey(d.entry.ref) === key || normalizeKey(d.entry.text) === key
      );
      if (exact) {
        out.push({
          from: ref(action.kind, action.index),
          to: ref(exact.kind, exact.index),
          relation: "implements",
          note: "carries out"
        });
        continue;
      }
    }
    const best = decisions.map((decision) => ({ decision, score: relatedness(action.entry.task, decision.entry.text) })).filter((s) => s.score >= LINK_THRESHOLD).sort((a, b) => b.score - a.score)[0];
    if (best) {
      out.push({
        from: ref(action.kind, action.index),
        to: ref(best.decision.kind, best.decision.index),
        relation: "implements",
        note: "carries out"
      });
    }
  }
  return out;
}
function linkPhaseDependencies(timeline) {
  const out = [];
  for (const later of timeline) {
    const needs = later.entry.requires;
    if (!needs) continue;
    const provider = timeline.filter((earlier) => earlier.index !== later.index && earlier.entry.produces).map((earlier) => ({ earlier, score: relatedness(earlier.entry.produces, needs) })).filter((s) => s.score >= LINK_THRESHOLD).sort((a, b) => b.score - a.score)[0];
    if (provider) {
      out.push({
        from: ref(provider.earlier.kind, provider.earlier.index),
        to: ref(later.kind, later.index),
        relation: "unblocks",
        note: `required before ${later.entry.title}`
      });
    }
  }
  return out;
}
function dedupe(relations) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const relation of relations) {
    if (relation.from === relation.to) continue;
    const key = `${relation.from}>${relation.relation}>${relation.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(relation);
  }
  return out;
}
var K = [
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
];
function rotr(x, n) {
  return x >>> n | x << 32 - n;
}
function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const withOne = bytes.length + 1;
  const paddedLen = Math.ceil((withOne + 8) / 64) * 64;
  const msg = new Uint8Array(paddedLen);
  msg.set(bytes);
  msg[bytes.length] = 128;
  const view = new DataView(msg.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 4294967296));
  view.setUint32(paddedLen - 4, bitLen >>> 0);
  let h0 = 1779033703;
  let h1 = 3144134277;
  let h2 = 1013904242;
  let h3 = 2773480762;
  let h4 = 1359893119;
  let h5 = 2600822924;
  let h6 = 528734635;
  let h7 = 1541459225;
  const w = new Int32Array(64);
  for (let block = 0; block < paddedLen; block += 64) {
    for (let t = 0; t < 16; t++) {
      w[t] = view.getInt32(block + t * 4);
    }
    for (let t = 16; t < 64; t++) {
      const w15 = w[t - 15];
      const w2 = w[t - 2];
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ w15 >>> 3;
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ w2 >>> 10;
      w[t] = w[t - 16] + s0 + w[t - 7] + s1 | 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let t = 0; t < 64; t++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = e & f ^ ~e & g;
      const temp1 = h + s1 + ch + K[t] + w[t] | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = a & b ^ a & c ^ b & c;
      const temp2 = s0 + maj | 0;
      h = g;
      g = f;
      f = e;
      e = d + temp1 | 0;
      d = c;
      c = b;
      b = a;
      a = temp1 + temp2 | 0;
    }
    h0 = h0 + a | 0;
    h1 = h1 + b | 0;
    h2 = h2 + c | 0;
    h3 = h3 + d | 0;
    h4 = h4 + e | 0;
    h5 = h5 + f | 0;
    h6 = h6 + g | 0;
    h7 = h7 + h | 0;
  }
  const hex = [h0, h1, h2, h3, h4, h5, h6, h7].map((n) => (n >>> 0).toString(16).padStart(8, "0")).join("");
  return hex;
}
function normalizeString(value) {
  return value.normalize("NFC").replace(/\r\n?/g, "\n");
}
function toCanonical(value) {
  if (value === null || value === void 0) return null;
  if (typeof value === "string") return normalizeString(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value;
  }
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(toCanonical);
  if (typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = toCanonical(value[key]);
    }
    return out;
  }
  return null;
}
function stableStringify(value) {
  return JSON.stringify(toCanonical(value));
}
function canonicalBlockProjection(block) {
  return {
    kind: block.kind,
    title: block.title,
    sourceOrder: block.sourceOrder,
    provenance: {
      method: block.provenance.method,
      label: block.provenance.label,
      locator: block.provenance.locator,
      excerpt: block.provenance.excerpt
    },
    payload: block.payload
  };
}
function canonicalDocumentProjection(doc) {
  return {
    schemaVersion: 1,
    title: doc.title,
    sourceMethod: doc.sourceMethod,
    sourceLabel: doc.sourceLabel,
    blocks: doc.blocks.map(canonicalBlockProjection),
    // Relations are addressed by kind and entry index, so they survive
    // reordering untouched and belong to the document's identity.
    relations: doc.relations,
    ...doc.archetype ? { archetype: doc.archetype } : {},
    ...doc.knowledgeGraph ? { knowledgeGraph: doc.knowledgeGraph } : {}
  };
}
function contentHashOf(doc) {
  return sha256Hex(stableStringify(canonicalDocumentProjection(doc)));
}
function stableBlockId(input) {
  return sha256Hex(stableStringify(input));
}
function shortHash(fullHex, length = 12) {
  return fullHex.slice(0, length);
}
var import_zod = __toESM(require_zod());
var BLOCK_KINDS = [
  "snapshot",
  "signals",
  "decisions",
  "timeline",
  "risks",
  "actions"
];
var blockKindSchema = import_zod.z.enum(BLOCK_KINDS);
var PROVENANCE_METHODS = [
  "deterministic-json",
  "local-parser",
  "ai",
  "recovered",
  "verified-example"
];
var provenanceMethodSchema = import_zod.z.enum(PROVENANCE_METHODS);
var textField = (max) => import_zod.z.string().min(1).max(max);
var signalEntrySchema = import_zod.z.object({
  label: textField(120),
  value: import_zod.z.union([import_zod.z.string().min(1).max(120), import_zod.z.number().finite()]).optional(),
  delta: import_zod.z.union([import_zod.z.string().max(120), import_zod.z.number().finite()]).optional(),
  trend: import_zod.z.enum(["up", "flat", "down"]).optional(),
  implication: textField(LIMITS.maxFieldLength).optional()
}).strict();
var decisionEntrySchema = import_zod.z.object({
  ref: textField(40).optional(),
  text: textField(LIMITS.maxFieldLength),
  status: import_zod.z.enum(["approved", "requested", "proposed", "rejected"]),
  commitment: import_zod.z.enum(["committed", "considered"]).optional(),
  because: textField(LIMITS.maxFieldLength).optional()
}).strict();
var timelineEntrySchema = import_zod.z.object({
  date: textField(80),
  title: textField(LIMITS.maxFieldLength),
  state: import_zod.z.enum(["shipped", "on-track", "planned", "done"]),
  produces: textField(240).optional(),
  requires: textField(240).optional(),
  /** Detail lines the source filed under this entry, verbatim. */
  details: import_zod.z.array(textField(LIMITS.maxFieldLength)).max(LIMITS.maxEntriesPerBlock).optional()
}).strict();
var riskEntrySchema = import_zod.z.object({
  risk: textField(LIMITS.maxFieldLength),
  severity: import_zod.z.enum(["high", "medium", "low"]).optional(),
  mitigation: textField(LIMITS.maxFieldLength).optional(),
  because: textField(LIMITS.maxFieldLength).optional(),
  consequence: textField(LIMITS.maxFieldLength).optional()
}).strict();
var ACTION_STATUSES = ["pending", "suggested", "ready", "done"];
var actionStatusSchema = import_zod.z.enum(ACTION_STATUSES);
var actionEntrySchema = import_zod.z.object({
  task: textField(LIMITS.maxFieldLength),
  owner: textField(120).optional(),
  due: textField(80).optional(),
  status: actionStatusSchema,
  /** The decision this action carries out, by `ref` or by its exact text. */
  from: textField(LIMITS.maxFieldLength).optional(),
  /**
   * Detail lines the source filed under this entity (a project's
   * accomplishment bullets, a workstream's todos). Verbatim evidence, never
   * invented; absent when the entry stood alone.
   */
  details: import_zod.z.array(textField(LIMITS.maxFieldLength)).max(LIMITS.maxEntriesPerBlock).optional()
}).strict();
var notesSchema = import_zod.z.array(import_zod.z.string().max(LIMITS.maxFieldLength)).max(LIMITS.maxNotesPerBlock);
var snapshotPayloadSchema = import_zod.z.object({
  heading: textField(LIMITS.maxFieldLength),
  summary: textField(LIMITS.maxFieldLength),
  hook: textField(300).optional(),
  goal: textField(LIMITS.maxFieldLength).optional(),
  problem: textField(LIMITS.maxFieldLength).optional(),
  outcome: textField(LIMITS.maxFieldLength).optional(),
  byline: textField(240).optional(),
  notes: notesSchema.optional()
}).strict();
var signalsPayloadSchema = import_zod.z.object({
  entries: import_zod.z.array(signalEntrySchema).max(LIMITS.maxEntriesPerBlock),
  notes: notesSchema.optional()
}).strict();
var decisionsPayloadSchema = import_zod.z.object({
  entries: import_zod.z.array(decisionEntrySchema).max(LIMITS.maxEntriesPerBlock),
  notes: notesSchema.optional()
}).strict();
var timelinePayloadSchema = import_zod.z.object({
  entries: import_zod.z.array(timelineEntrySchema).max(LIMITS.maxEntriesPerBlock),
  notes: notesSchema.optional()
}).strict();
var risksPayloadSchema = import_zod.z.object({
  entries: import_zod.z.array(riskEntrySchema).max(LIMITS.maxEntriesPerBlock),
  notes: notesSchema.optional()
}).strict();
var actionsPayloadSchema = import_zod.z.object({
  entries: import_zod.z.array(actionEntrySchema).max(LIMITS.maxEntriesPerBlock),
  notes: notesSchema.optional()
}).strict();
var blockPayloadSchema = import_zod.z.union([
  snapshotPayloadSchema,
  signalsPayloadSchema,
  decisionsPayloadSchema,
  timelinePayloadSchema,
  risksPayloadSchema,
  actionsPayloadSchema
]);
var MEMORY_RELATIONS = [
  /** A signal that shaped a decision. */
  "informs",
  /** Evidence that backs a decision or requirement. */
  "supports",
  /** A risk or need that drives a decision. */
  "motivates",
  /** A decision or action that lessens a risk. */
  "mitigates",
  /** Causal pressure from one memory onto another. */
  "causes",
  /** An unresolved question or dependency a decision waits on. */
  "depends_on",
  /** Something that prevents settling or shipping. */
  "blocks",
  /** An action that carries out a decision. */
  "implements",
  /** A timeline phase that places an action in time. */
  "schedules",
  /** A signal that exposes a risk. */
  "threatens",
  /** The snapshot framing everything under it. */
  "frames",
  /** A phase that leaves an artifact another phase needs. */
  "unblocks"
];
var memoryRelationKindSchema = import_zod.z.enum(MEMORY_RELATIONS);
var MEMORY_REF = /^(snapshot|signals|decisions|timeline|risks|actions)(:\d{1,3})?$/;
var memoryRefSchema = import_zod.z.string().regex(MEMORY_REF).max(24);
var memoryRelationSchema = import_zod.z.object({
  from: memoryRefSchema,
  to: memoryRefSchema,
  relation: memoryRelationKindSchema,
  /** Short human phrasing shown in the UI, e.g. "because lead times slipped". */
  note: textField(200).optional()
}).strict();
var knowledgeGraphNodeSchema = import_zod.z.object({
  id: import_zod.z.string().min(1).max(120),
  label: import_zod.z.string().min(1).max(400),
  kind: import_zod.z.string().min(1).max(60).optional(),
  role: import_zod.z.string().min(1).max(60).optional(),
  source_file: import_zod.z.string().max(200).optional(),
  source_location: import_zod.z.string().max(120).optional(),
  community: import_zod.z.union([import_zod.z.number(), import_zod.z.string()]).optional()
}).strict();
var knowledgeGraphEdgeSchema = import_zod.z.object({
  source: import_zod.z.string().min(1).max(120),
  target: import_zod.z.string().min(1).max(120),
  relation: import_zod.z.string().min(1).max(80),
  confidence: import_zod.z.enum(["EXTRACTED", "INFERRED", "AMBIGUOUS"])
}).strict();
var knowledgeGraphSchema = import_zod.z.object({
  nodes: import_zod.z.array(knowledgeGraphNodeSchema).max(2e3),
  edges: import_zod.z.array(knowledgeGraphEdgeSchema).max(5e3),
  schema: import_zod.z.literal("graphify-v1"),
  extractor: import_zod.z.string().min(1).max(120),
  analysis: import_zod.z.object({
    god_nodes: import_zod.z.array(
      import_zod.z.object({
        id: import_zod.z.string(),
        label: import_zod.z.string(),
        degree: import_zod.z.number().optional()
      }).strict()
    ).max(32).optional(),
    surprising_connections: import_zod.z.array(
      import_zod.z.object({
        source: import_zod.z.string(),
        target: import_zod.z.string(),
        relation: import_zod.z.string(),
        confidence: import_zod.z.enum(["EXTRACTED", "INFERRED", "AMBIGUOUS"]).optional()
      }).strict()
    ).max(64).optional(),
    suggested_questions: import_zod.z.array(import_zod.z.string().max(240)).max(12).optional()
  }).strict().optional(),
  graphify_status: import_zod.z.string().max(400).optional()
}).strict();
var documentArchetypeInfoSchema = import_zod.z.object({
  id: import_zod.z.string().min(1).max(40),
  label: import_zod.z.string().min(1).max(80),
  /**
   * Winner raw cue score when specialized.
   * Omitted for Generic Knowledge (fallback has no score).
   */
  score: import_zod.z.number().min(0).max(100).optional(),
  /** Raw specialized scores for debugging. */
  scores: import_zod.z.object({
    resume: import_zod.z.number().min(0).max(100),
    research: import_zod.z.number().min(0).max(100),
    invoice: import_zod.z.number().min(0).max(100)
  }).optional(),
  /** Cue labels that fired for the projected (or best) archetype. */
  reasons: import_zod.z.array(import_zod.z.string().min(1).max(80)).max(24).optional(),
  /** @deprecated AI-path 0–1 confidence; prefer `score` for local detector. */
  confidence: import_zod.z.number().min(0).max(1).optional()
}).strict();
var sourceBlockBase = {
  title: textField(LIMITS.maxBlockTitleLength).optional()
};
var sourceBlockSchema = import_zod.z.discriminatedUnion("kind", [
  import_zod.z.object({ kind: import_zod.z.literal("snapshot"), ...sourceBlockBase, payload: snapshotPayloadSchema }).strict(),
  import_zod.z.object({ kind: import_zod.z.literal("signals"), ...sourceBlockBase, payload: signalsPayloadSchema }).strict(),
  import_zod.z.object({ kind: import_zod.z.literal("decisions"), ...sourceBlockBase, payload: decisionsPayloadSchema }).strict(),
  import_zod.z.object({ kind: import_zod.z.literal("timeline"), ...sourceBlockBase, payload: timelinePayloadSchema }).strict(),
  import_zod.z.object({ kind: import_zod.z.literal("risks"), ...sourceBlockBase, payload: risksPayloadSchema }).strict(),
  import_zod.z.object({ kind: import_zod.z.literal("actions"), ...sourceBlockBase, payload: actionsPayloadSchema }).strict()
]);
var memorySourceSchema = import_zod.z.object({
  version: import_zod.z.literal(1),
  title: textField(LIMITS.maxTitleLength),
  blocks: import_zod.z.array(sourceBlockSchema).min(1).max(LIMITS.maxBlocks),
  /** Optional: edges between memories, recomputed when absent. */
  relations: import_zod.z.array(memoryRelationSchema).max(LIMITS.maxRelations).optional(),
  /** Optional: drives UI bucket labels after projection. */
  archetype: documentArchetypeInfoSchema.optional()
}).strict();
var blockProvenanceSchema = import_zod.z.object({
  method: provenanceMethodSchema,
  /** Sanitized human source label, e.g. "atlas-q3-brief.json" or "Pasted notes". */
  label: import_zod.z.string().max(LIMITS.maxSourceLabelLength),
  /** Exact JSON path ("blocks[1]") or heading / 1-based line range ("lines 6–9"). */
  locator: import_zod.z.string().max(200),
  /** Plain-text source excerpt, capped at 240 characters. Escaped at render. */
  excerpt: import_zod.z.string().max(LIMITS.maxExcerptLength)
}).strict();
var memoryBlockSchema = import_zod.z.object({
  id: import_zod.z.string().min(1).max(80),
  kind: blockKindSchema,
  title: import_zod.z.string().min(1).max(LIMITS.maxBlockTitleLength),
  sourceOrder: import_zod.z.number().int().nonnegative(),
  provenance: blockProvenanceSchema,
  payload: blockPayloadSchema
}).strict();
var importWarningSchema = import_zod.z.object({
  code: import_zod.z.string().min(1).max(60),
  message: import_zod.z.string().min(1).max(500)
}).strict();
var memoryDocumentSchema = import_zod.z.object({
  schemaVersion: import_zod.z.literal(1),
  title: import_zod.z.string().min(1).max(LIMITS.maxTitleLength),
  /** Stable, content-derived document id. */
  documentId: import_zod.z.string().min(1).max(80),
  sourceMethod: provenanceMethodSchema,
  sourceLabel: import_zod.z.string().max(LIMITS.maxSourceLabelLength),
  /** SHA-256 of the stable canonical serialization. */
  contentHash: import_zod.z.string().min(1).max(80),
  blocks: import_zod.z.array(memoryBlockSchema).min(1).max(LIMITS.maxBlocks),
  /** Edges between memories. Always present, possibly empty. */
  relations: import_zod.z.array(memoryRelationSchema).max(LIMITS.maxRelations),
  warnings: import_zod.z.array(importWarningSchema).max(200),
  /** Optional: which adaptive projection selected and labeled the memories. */
  archetype: documentArchetypeInfoSchema.optional(),
  /**
   * Optional Graphify-schema knowledge graph (paper/concepts/citations).
   * Separate from `relations`, which link the six memory cards.
   */
  knowledgeGraph: knowledgeGraphSchema.optional()
}).strict();
var BLOCK_KIND_LABELS = {
  snapshot: "Snapshot",
  signals: "Signals",
  decisions: "Decisions",
  timeline: "Timeline",
  risks: "Risks",
  actions: "Actions"
};
var BLOCK_KIND_SUBTITLES = {
  snapshot: "What this document is about",
  signals: "Patterns the document suggests",
  decisions: "Commitments inside the document",
  timeline: "Important chronological events",
  risks: "Potential concerns or blockers",
  actions: "What someone should do next"
};
function buildBlockId(kind, title, payload, locator) {
  return `blk_${kind}_${shortHash(stableBlockId({ kind, title, payload, locator }))}`;
}
function finalizeDocument(input) {
  const blocks = input.blocks.map((b, index) => {
    const title = b.title ?? BLOCK_KIND_LABELS[b.kind];
    return {
      id: buildBlockId(b.kind, title, b.payload, b.provenance.locator),
      kind: b.kind,
      title,
      sourceOrder: index,
      provenance: b.provenance,
      payload: b.payload
    };
  });
  const draft2 = {
    schemaVersion: 1,
    title: input.title,
    documentId: "",
    sourceMethod: input.sourceMethod,
    sourceLabel: input.sourceLabel,
    contentHash: "",
    blocks,
    relations: input.relations ? [...input.relations] : buildRelations(blocks),
    warnings: input.warnings,
    ...input.archetype ? { archetype: input.archetype } : {},
    ...input.knowledgeGraph ? { knowledgeGraph: input.knowledgeGraph } : {}
  };
  const hash2 = contentHashOf(draft2);
  return { ...draft2, contentHash: hash2, documentId: `doc_${shortHash(hash2)}` };
}
var MIN_SCORE = 10;
var MIN_MARGIN = 4;
var SPECIALIZED = [
  {
    archetype: "resume",
    label: "Resume",
    timelineMode: "narrative_sequence",
    cues: [
      {
        label: "Education",
        weight: 4,
        pattern: /\b(education|academic\s+background|academics?|education\s+history)\b/i
      },
      {
        label: "Experience",
        weight: 4,
        // Synonyms: Experience, Employment, Work History, Professional Experience, …
        pattern: /\b(work\s+experience|professional\s+experience|employment(?:\s+history)?|work\s+history|career\s+history|experience)\b/i
      },
      {
        label: "Projects",
        weight: 3,
        pattern: /\b(projects?|portfolio|personal\s+projects?|selected\s+projects?)\b/i
      },
      {
        label: "Skills",
        weight: 3,
        pattern: /\b(technical\s+skills|core\s+skills|skills|competencies|technologies)\b/i
      },
      {
        label: "Achievements",
        weight: 2,
        pattern: /\b(achievements?|awards?|accomplishments?|honou?rs?)\b/i
      },
      {
        label: "Email",
        weight: 1,
        pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
      },
      {
        label: "Phone",
        weight: 1,
        pattern: /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}\b/
      },
      {
        label: "GPA",
        weight: 1,
        pattern: /\b(?:c?gpa|g\.?p\.?a\.?)\b/i
      }
    ]
  },
  {
    archetype: "research",
    label: "Research",
    timelineMode: "narrative_sequence",
    cues: [
      { label: "Abstract", weight: 4, pattern: /\babstract\b/i },
      {
        label: "Method",
        weight: 4,
        pattern: /\b(method(?:ology)?|methods)\b/i
      },
      { label: "Results", weight: 4, pattern: /\bresults?\b/i },
      {
        label: "Discussion",
        weight: 3,
        pattern: /\b(discussion|conclusion|conclusions)\b/i
      },
      { label: "References", weight: 3, pattern: /\breferences?\b/i },
      {
        label: "Dataset",
        weight: 2,
        pattern: /\b(dataset|data\s+set|experiment(?:s|al)?)\b/i
      },
      { label: "Hypothesis", weight: 2, pattern: /\bhypothes[ie]s\b/i }
    ]
  },
  {
    archetype: "invoice",
    label: "Invoice",
    timelineMode: "obligation_deadlines",
    cues: [
      {
        label: "Invoice Number",
        weight: 5,
        pattern: /\b(?:invoice\s*(?:number|no\.?|#)|inv[#:\s-]*\w+|receipt\s*(?:number|no\.?|#))\b/i
      },
      {
        label: "Vendor",
        weight: 4,
        pattern: /\b(vendor|supplier|bill\s+to|sold\s+by|from:)\b/i
      },
      {
        label: "Total Amount",
        weight: 4,
        pattern: /\b(total\s+amount|amount\s+due|grand\s+total|balance\s+due|total\s+due)\b/i
      },
      {
        label: "Due Date",
        weight: 3,
        pattern: /\b(due\s+date|payment\s+due|pay\s+by)\b/i
      },
      {
        label: "Line Items",
        weight: 3,
        pattern: /\b(line\s+items?|unit\s+price|qty|quantity)\b/i
      },
      {
        label: "Tax",
        weight: 2,
        pattern: /\b(gst|vat|sales\s+tax|tax\s+amount|tax)\b/i
      },
      {
        label: "Payment Terms",
        weight: 2,
        pattern: /\b(payment\s+terms|net\s+\d+|terms\s+of\s+payment)\b/i
      }
    ]
  }
];
function scoreSpec(haystack, spec) {
  let score = 0;
  const reasons = [];
  for (const cue of spec.cues) {
    if (cue.pattern.test(haystack)) {
      score += cue.weight;
      reasons.push(cue.label);
    }
  }
  return { spec, score, reasons };
}
function rankScores(breakdowns) {
  const sorted = [...breakdowns].sort((a, b) => b.score - a.score);
  return {
    winner: sorted[0],
    runnerUp: sorted[1]
  };
}
function classifyArchetype(input) {
  const haystack = `${input.title}
${input.headings.join("\n")}
${input.bodySample.slice(0, 4e3)}`;
  const breakdowns = SPECIALIZED.map((spec) => scoreSpec(haystack, spec));
  const scores = {
    resume: breakdowns.find((b) => b.spec.archetype === "resume").score,
    research: breakdowns.find((b) => b.spec.archetype === "research").score,
    invoice: breakdowns.find((b) => b.spec.archetype === "invoice").score
  };
  const { winner, runnerUp } = rankScores(breakdowns);
  const margin = winner.score - runnerUp.score;
  const winsSpecialized = winner.score >= MIN_SCORE && margin >= MIN_MARGIN;
  if (winsSpecialized) {
    return {
      archetype: winner.spec.archetype,
      label: winner.spec.label,
      score: winner.score,
      scores,
      reasons: winner.reasons,
      timelineMode: winner.spec.timelineMode,
      suppressWeakTimeline: winner.spec.timelineMode === "none"
    };
  }
  return {
    archetype: "generic",
    label: "Generic Knowledge",
    scores,
    reasons: winner.score > 0 ? winner.reasons : [],
    timelineMode: "narrative_sequence",
    suppressWeakTimeline: false
  };
}
var TITLE_MARKERS = [
  [/\b(guide|playbook|handbook|tutorial|how\s?to|walkthrough|workflow|method|framework|approach|cookbook|primer)\b/i, "guide"],
  [/\b(spec|specification|rfc|design\s+doc|architecture|requirements?|prd|product requirements?|contract|standard)\b/i, "spec"],
  [/\b(plan|roadmap|schedule|phases?|milestones?|timeline|rollout|launch)\b/i, "plan"],
  [/\b(review|retro|retrospective|post\s?-?mortem|learnings?|results|report|recap|wrap\s?-?up)\b/i, "review"],
  [/\b(analysis|assessment|audit|study|research|teardown|deep\s?dive|investigation|diagnosis)\b/i, "analysis"],
  [/\b(brief|memo|summary|update|digest|overview|snapshot)\b/i, "brief"]
];
var VERB_FOR = {
  guide: "walks through",
  plan: "lays out",
  review: "takes stock of",
  brief: "brings you up to speed on",
  spec: "pins down",
  analysis: "works through",
  notes: "records"
};
var IMPERATIVE2 = /^(use|build|create|write|run|start|open|clean|check|add|remove|keep|make|set|pick|choose|avoid|never|always|do not|don't|prefer|ensure|define|split|group|review|send|ship|test|map|list|draft|treat|store|apply|focus|begin|finish|repeat|validate|verify|export|import|document|measure|track)\b/i;
var MEASURED2 = /[0-9]+\s*(%|pts?|pp\b|ms\b|bps\b|x\b|k\b|m\b|bn?\b)|[$€£₹]\s*[0-9]|[0-9]+(?:\.[0-9]+)?\s*(hours?|days?|weeks?|months?|users?|customers?|orders?)/i;
var SEQUENCED = /\b(phase|step|stage|milestone|sprint|week|day|quarter|q[1-4]\b|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|20\d\d-\d\d-\d\d)\b/i;
function readIntent(input) {
  const { title, headings, lines } = input;
  const body = lines.join("\n");
  const sentences = lines.flatMap((line) => splitSentences(line));
  const total = Math.max(1, sentences.length);
  const instructionalCount = sentences.filter((s) => IMPERATIVE2.test(s.trim())).length;
  const measuredCount = lines.filter((l) => MEASURED2.test(l)).length;
  const sequencedCount = [...headings, ...lines].filter((l) => SEQUENCED.test(l)).length;
  const instructional = instructionalCount / total >= 0.22;
  const measured = measuredCount / Math.max(1, lines.length) >= 0.18;
  const sequenced = sequencedCount / Math.max(1, headings.length + lines.length) >= 0.12;
  return {
    kind: chooseKind({ title, headings, body, instructional, measured, sequenced }),
    verb: "",
    // Prefer a purpose sentence from the opening when the title only names the
    // document. "Finsight v3 Specification" tells you the binder; "a financial
    // advisor" tells you what the binder is for.
    subject: purposeFromBody(lines) || subjectOf(title),
    instructional,
    measured,
    sequenced
  };
}
function purposeFromBody(lines) {
  for (const line of lines.slice(0, 12)) {
    const match = /\bis\s+(?:a|an)\s+(.{8,90}?)(?:\s+built\b|\s+designed\b|\s+meant\b|\s+intended\b|\s+created\b|[.;]|$)/i.exec(
      line
    );
    if (!match) continue;
    const purpose = unpunctuated(match[1] ?? "").trim();
    if (contentTokens(purpose).length >= 2) return purpose;
  }
  return "";
}
function understandIntent(input) {
  const intent = readIntent(input);
  return { ...intent, verb: VERB_FOR[intent.kind] };
}
function chooseKind(args) {
  for (const [pattern, kind] of TITLE_MARKERS) {
    if (pattern.test(args.title)) return kind;
  }
  const headingText = args.headings.join(" ");
  for (const [pattern, kind] of TITLE_MARKERS) {
    if (pattern.test(headingText)) return kind;
  }
  if (args.instructional && args.sequenced) return "guide";
  if (args.instructional) return "spec";
  if (args.measured) return "review";
  if (args.sequenced) return "plan";
  return "notes";
}
var TYPE_NOUN = /\b(guide|playbook|handbook|tutorial|walkthrough|spec|specification|rfc|plan|roadmap|review|retro|retrospective|report|recap|analysis|assessment|audit|study|brief|memo|summary|update|overview|notes?|document|doc)\b/gi;
function subjectOf(title) {
  const stripped = unpunctuated(
    title.replace(TYPE_NOUN, " ").replace(/\s*[:|·]\s*/g, " ").replace(/\s+/g, " ")
  ).trim();
  if (contentTokens(stripped).length === 0) return unpunctuated(title);
  if (stripped.split(/\s+/).length < 2 && title.split(/\s+/).length > 1) return unpunctuated(title);
  return stripped;
}
var EXTRACTIVE_ARCHETYPES = /* @__PURE__ */ new Set(["resume", "invoice"]);
var LEVERAGE = /\b(therefore|so that|because|means|signals|indicates|suggests|points to|drives|unlocks|enables|prevents|avoids|instead of|rather than|but|however|yet|while|although|trade[- ]?off|constraint|root cause|bottleneck|non-negotiable|key|takeaway|insight|lesson|aha|matters)\b/i;
var PRODUCT_PHILOSOPHY = /\b(memory|recall|understand|semantic|source[- ]?linked|evidence|trust|audit|trace|workflow|decision|risk|action|timeline|block|projection|classification|architecture|reliability|failure)\b/i;
var EXTRACTIVE_CHROME = /\b(email|phone|address|invoice\s*(?:no|number|#)|amount due|total|subtotal|tax|gpa|education|experience|skills)\b/i;
function deriveHeroInsights(input) {
  if (EXTRACTIVE_ARCHETYPES.has(input.archetype)) return [];
  const ranked = input.statements.map((statement) => scoreStatement(statement, input.concepts)).filter((candidate) => candidate !== null).sort((a, b) => b.score - a.score || a.statement.lineNo - b.statement.lineNo);
  const out = [];
  for (const candidate of ranked) {
    if (out.length >= 3) break;
    const entry = insightEntry(candidate, input.concepts);
    if (!entry) continue;
    if (input.existingSignals.some((s) => overlapsSignal(s, entry))) continue;
    if (out.some((i) => overlapsSignal(i.entry, entry))) continue;
    out.push({ entry, evidence: candidate.statement, score: candidate.score });
  }
  return out;
}
function scoreStatement(statement, concepts) {
  const text = unpunctuated(statement.text);
  const words = wordCount(text);
  if (words < 8 || words > 42) return null;
  if (EXTRACTIVE_CHROME.test(text)) return null;
  let score = 0;
  if (LEVERAGE.test(text)) score += 5;
  if (PRODUCT_PHILOSOPHY.test(text)) score += 3;
  if (/\b(?:not|never|without|only|instead|rather than)\b/i.test(text)) score += 2;
  if (/\b(?:fail|failure|risk|core|primary|highest|single|must|cannot)\b/i.test(text)) score += 2;
  score += Math.min(4, concepts.filter((c) => containsPhrase(text, c.phrase)).length);
  if (statement.sectionTitle && /\b(problem|insight|lesson|strategy|architecture|requirement|philosophy|why)\b/i.test(statement.sectionTitle)) {
    score += 2;
  }
  return score >= 6 ? { statement, score } : null;
}
function insightEntry(candidate, concepts) {
  const text = unpunctuated(candidate.statement.text);
  const theme = concepts.find((c) => containsPhrase(text, c.phrase))?.phrase;
  const label = sentenceCase(clampWords(theme || candidate.statement.sectionTitle || "Hero insight", 8));
  const implication = synthesizeImplication(text);
  if (!implication || readsAsFragment(implication)) return null;
  return {
    label,
    implication: implication.slice(0, LIMITS.maxFieldLength)
  };
}
function synthesizeImplication(text) {
  const clean = sentenceCase(clampWords(text, 26));
  const because = /(.{6,180})\s+because\s+(.{6,180})/i.exec(text);
  if (because) return sentenceCase(`The important part is ${clampWords(because[1], 14)}; the reason is ${clampWords(because[2], 12)}`);
  const contrast = /(.{6,180})\s+(?:but|however|yet|while|although)\s+(.{6,180})/i.exec(text);
  if (contrast) return sentenceCase(`The aha is the tension: ${clampWords(contrast[1], 12)} vs ${clampWords(contrast[2], 12)}`);
  const means = /(.{6,180})\s+(?:means|signals|indicates|suggests|points to)\s+(.{6,180})/i.exec(text);
  if (means) return sentenceCase(`${clampWords(means[1], 12)} is evidence that ${clampWords(means[2], 14)}`);
  return clean;
}
function containsPhrase(text, phrase) {
  return phrase.length >= 4 && text.toLowerCase().includes(phrase.toLowerCase());
}
function overlapsSignal(a, b) {
  const left = `${a.label} ${a.implication ?? ""}`.toLowerCase();
  const right = `${b.label} ${b.implication ?? ""}`.toLowerCase();
  const l = new Set(left.split(/\W+/).filter((w) => w.length > 4));
  const r = right.split(/\W+/).filter((w) => w.length > 4);
  if (l.size === 0 || r.length === 0) return false;
  return r.filter((w) => l.has(w)).length / Math.min(l.size, r.length) >= 0.6;
}
var DECIDED = /\b(we|i|the team)\s+(?:have\s+)?(?:decided|chose|chosen|committed|approved|agreed)\b|^decision\s*[:—-]/i;
var TODO_HINT = /\b(should|need to|needs to|have to|todo|to-do|follow[- ]?up|action item|please\s+\w+|someone (?:should|must|needs to)|we need to|let'?s)\b/i;
var SCHEDULE_ORDINAL_MARKER = /^(phase|task|step|stage|milestone|sprint|iteration|week|day)\b/i;
var WORK_LEAD = (
  // "write" excludes the cache terms write-through / write-back / write-ahead
  // ("Write-through invalidation adds 4 ms" is a cost, not the work verb write),
  // but not the phrasal task "Write back to the customer".
  /^(?:draft|chase|send|write(?!-(?:through|back|ahead)\b)(?! (?:through|ahead)\b)(?! back (?:cache|caching|policy|mode|latency|path|buffer)\b)|implement|build|create|fix|review|schedule|call|email|prepare|ship|deploy|spec|document|measure|track|add|remove|contact|follow up)\b/i
);
var NON_ACTION = /\b(nothing parseable|not a metric|opening thought|random notes|just one paragraph)\b/i;
var DELIVERY = /\b(due(?:\s+date)?|by\s+(?:the\s+)?(?:end\s+of\s+)?(?:next\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}|q[1-4]|monday|tuesday|wednesday|thursday|friday|week|month|quarter|year)|before|after|until|ship(?:ped|ping)?|freeze|deadline|ready|phase\s+\d|milestone|sprint|gate|eta|planned|on[- ]track|need(?:s)?\s+to)\b/i;
var BYLINE = /\b(prepared|reviewed|authored|written)\s+by\b/i;
function inferTimeline(statements) {
  const out = [];
  for (const statement of statements) {
    const claimed = kindClaimedByHeading(statement.sectionTitle);
    if (claimed && claimed !== "timeline" && claimed !== "snapshot") continue;
    const ordinal = statement.sectionTitle ? matchOrdinalHeading(statement.sectionTitle) : null;
    if (ordinal && SCHEDULE_ORDINAL_MARKER.test(ordinal.marker)) continue;
    const text = unpunctuated(statement.text);
    if (wordCount(text) < 3) continue;
    const underTimeline = claimed === "timeline" || statement.listItem;
    if (!underTimeline && BYLINE.test(text)) continue;
    const strict = parseTimelineLine(statement.text) ?? parseTimelineLine(`- ${statement.text}`);
    if (strict && strict.title.trim().length >= 2) {
      if (!underTimeline && !DELIVERY.test(text)) continue;
      out.push({ value: strict, evidence: statement });
      continue;
    }
    const found = findDateToken(text);
    if (!found) continue;
    if (!underTimeline && !DELIVERY.test(text)) continue;
    const title = titleAroundRemovedDate(text, found.index, found.length);
    if (title.length < 3 || wordCount(title) < 2) continue;
    out.push({
      value: {
        date: found.date,
        title: sentenceCase(clampWords(title, 24)),
        state: "planned"
      },
      evidence: statement
    });
  }
  return out;
}
function inferActions(statements, unheadedClaim = null) {
  const out = [];
  let tableHeader = null;
  for (const statement of statements) {
    const claimed = kindClaimedByHeading(statement.sectionTitle) ?? (statement.sectionTitle == null ? unheadedClaim : null);
    if (claimed && claimed !== "actions" && claimed !== "snapshot") continue;
    if (statement.sectionTitle && VERDICT_HEADING.test(statement.sectionTitle)) continue;
    const text = unpunctuated(statement.text);
    if (wordCount(text) < 3) continue;
    if (NON_ACTION.test(text)) continue;
    if (statement.task) {
      const status = statement.task === "done" ? "done" : "pending";
      const parsedTask = parseActionLine(statement.text) ?? parseActionLine(`- ${statement.text}`);
      if (parsedTask && parsedTask.task.trim().length >= 3) {
        out.push({ value: { ...parsedTask, status }, evidence: statement });
        continue;
      }
      const task2 = sentenceCase(clampWords(text, 28));
      if (task2.length >= 8) {
        out.push({ value: { task: task2, status }, evidence: statement });
      }
      continue;
    }
    if (claimed !== "actions" && splitTableRow(statement.text)) continue;
    if (strongestCategory(text) === "risk") continue;
    if (DECIDED.test(text) && !TODO_HINT.test(text)) continue;
    if (isTaskTableHeaderRow(statement.text)) {
      tableHeader = {
        section: statement.sectionTitle ?? null,
        cells: splitTableRow(statement.text).map((c) => c.trim().toLowerCase())
      };
      continue;
    }
    if (splitTableRow(statement.text)) {
      const cells = splitTableRow(statement.text);
      const hdr = tableHeader && tableHeader.section === (statement.sectionTitle ?? null) ? tableHeader.cells : null;
      if (hdr) {
        const colIdx = (re) => hdr.findIndex((c) => re.test(c));
        const ownerIdx = colIdx(/^(owners?|assignees?|assigned\s*to|responsible)$/);
        const dueIdx = colIdx(/^(due(\s*dates?)?|deadlines?)$/);
        const statusIdx = colIdx(/^status$/);
        const taskText = (cells[0] ?? "").trim();
        if (taskText.length >= 3) {
          const statusText = statusIdx >= 0 ? (cells[statusIdx] ?? "").trim() : "";
          const entry = {
            task: taskText,
            status: statusText ? inferReadiness(statusText) : inferReadiness(taskText)
          };
          const owner = ownerIdx >= 0 ? (cells[ownerIdx] ?? "").trim() : "";
          const due = dueIdx >= 0 ? (cells[dueIdx] ?? "").trim() : "";
          if (owner) entry.owner = owner;
          if (due) entry.due = due;
          out.push({ value: entry, evidence: statement });
        }
        continue;
      }
      const parsedRow = parseActionLine(statement.text);
      if (parsedRow && parsedRow.task.trim().length >= 3) {
        out.push({ value: parsedRow, evidence: statement });
        continue;
      }
      const cellText = unpunctuated((cells[0] ?? "").trim());
      const task2 = sentenceCase(clampWords(cellText, 28));
      if ((TODO_HINT.test(cellText) || WORK_LEAD.test(cellText)) && task2.length >= 8) {
        const entry = { task: task2, status: "pending" };
        const owner = (cells[1] ?? "").trim();
        const due = (cells[2] ?? "").trim();
        if (owner) entry.owner = owner;
        if (due) entry.due = due;
        out.push({ value: entry, evidence: statement });
      }
      continue;
    }
    const parsed = parseUserStoryLine(statement.text) ?? parseUserStoryLine(`- ${statement.text}`) ?? parseActionLine(statement.text) ?? parseActionLine(`- ${statement.text}`);
    if (parsed && parsed.task.trim().length >= 3) {
      out.push({ value: parsed, evidence: statement });
      continue;
    }
    if (!TODO_HINT.test(text) && !(statement.listItem && WORK_LEAD.test(text))) continue;
    if (strongestCategory(text) === "requirement" && !TODO_HINT.test(text) && !WORK_LEAD.test(text)) {
      continue;
    }
    const task = sentenceCase(clampWords(text, 28));
    if (task.length < 8) continue;
    out.push({
      value: { task, status: "pending" },
      evidence: statement
    });
  }
  return out;
}
var KIND_NOUN = {
  guide: "guide",
  plan: "plan",
  review: "review",
  brief: "brief",
  spec: "spec",
  analysis: "analysis",
  notes: "set of notes"
};
function composeRecall(input) {
  const goal = primaryGoal(input);
  const problem = primaryProblem(input);
  const outcome = primaryOutcome(input);
  const clauses = [];
  const framed = Boolean(goal || problem || outcome);
  const waiting = outstandingWorkClause(input.timeline, input.actions);
  if (!framed) {
    if (input.fallback.trim()) {
      return {
        summary: clampWords(unpunctuated(input.fallback), LIMITS.maxSnapshotWords),
        composed: false,
        hook: hookLine(input),
        goal: "",
        problem: "",
        outcome: "",
        readingMinutes: readingMinutes(input)
      };
    }
    const subject = shorten(input.intent.subject, 12);
    const opening = subject.length > 0 ? `This ${KIND_NOUN[input.intent.kind]} pins down ${subject}.` : "";
    if (opening) clauses.unshift(opening);
    const commitment = commitmentClause(input.decisions);
    if (commitment) clauses.push(commitment);
  } else {
    if (input.fallback.trim()) {
      const framing = sentenceCase(shorten(unpunctuated(input.fallback), 22));
      if (framing && !readsAsFragment(framing)) clauses.push(framing);
    } else if (goal) {
      clauses.push(`This ${KIND_NOUN[input.intent.kind]} remembers ${decapitalize(shorten(goal, 16))}.`);
    }
    if (waiting) clauses.push(waiting);
  }
  const composed = framed || clauses.length >= 1;
  const summary = composed ? withinBudget(clauses) : clampWords(unpunctuated(input.fallback) || goal || subjectFallback(input), LIMITS.maxSnapshotWords);
  return {
    summary: summary.trim() || (goal ? `Primary goal: ${goal}.` : ""),
    composed,
    hook: goal ? `Primary goal: ${goal}.` : hookLine(input),
    goal,
    problem,
    outcome,
    readingMinutes: readingMinutes(input)
  };
}
function subjectFallback(input) {
  return shorten(input.intent.subject, 12);
}
function primaryGoal(input) {
  const committed = input.decisions.filter(
    (d) => d.commitment === "committed" && d.status !== "rejected" && !/^p\d\b/i.test(d.text)
  );
  const preferred = committed.find((d) => /\b(audit|edit history|amend|traceable|editable)\b/i.test(d.text)) ?? committed[0];
  if (preferred) {
    const text = sentenceCase(shorten(preferred.text, 18));
    if (!readsAsFragment(text)) {
      if (/^(enable|deliver|provide|support|build|create)\b/i.test(text)) return text;
      return `Enable ${decapitalize(text)}`;
    }
  }
  const story = input.actions.find((a) => /^user story:/i.test(a.task));
  if (story) {
    const want = story.task.replace(/^user story:\s*/i, "");
    return sentenceCase(shorten(want.replace(/^i want (?:to\s+)?/i, ""), 18));
  }
  return "";
}
function primaryProblem(input) {
  const ranked = [...input.risks].sort((a, b) => severityRank(b) - severityRank(a));
  const withCost = ranked.find((r) => r.consequence);
  if (withCost) {
    return sentenceCase(
      shorten(`${withCost.risk}, causing ${withCost.consequence}`, 22)
    );
  }
  if (ranked[0]) return sentenceCase(shorten(ranked[0].risk, 20));
  return "";
}
function primaryOutcome(input) {
  const measured = input.signals.find(
    (s) => s.value !== void 0 && !/^open question$/i.test(s.label)
  );
  if (measured?.implication && measured.implication !== "Target") {
    return sentenceCase(shorten(`${measured.label}: ${measured.implication}`, 18));
  }
  const theme = input.concepts.find(
    (c) => /\b(mid-market|compliance|audit|onboarding|procurement)\b/i.test(c.phrase)
  );
  if (theme) {
    return sentenceCase(`Support ${decapitalize(shorten(theme.phrase, 12))} through traceable workflows`);
  }
  const committed = input.decisions.find((d) => /\b(compliance|audit|mid-market|accountab)/i.test(d.text));
  if (committed) return sentenceCase(shorten(committed.text, 18));
  return "";
}
function commitmentClause(decisions) {
  const committed = decisions.filter((d) => d.commitment !== "considered" && d.status !== "rejected").map((d) => decapitalize(shorten(d.text, 10))).filter((t) => wordCount(t) >= 2 && !readsAsFragment(t)).slice(0, 2);
  if (committed.length === 0) return "";
  return `It settles on ${speakList(committed)}.`;
}
function severityRank(risk) {
  if (risk.severity === "high") return 3;
  if (risk.severity === "medium") return 2;
  if (risk.severity === "low") return 1;
  return 0;
}
function outstandingWorkClause(timeline, actions) {
  const tickets = timeline.map((t) => {
    const fromDate = /^(PSTD-\d+|[A-Z]{2,5}-\d+)/i.exec(t.date)?.[1];
    const fromTitle = /^(PSTD-\d+|[A-Z]{2,5}-\d+)/i.exec(t.title)?.[1];
    return fromDate ?? fromTitle ?? null;
  }).filter((t) => Boolean(t));
  const uniqueTickets = [...new Set(tickets.map((t) => t.toUpperCase()))];
  const waitingActions = actions.filter(
    (a) => a.status !== "done" && !/^persona:/i.test(a.task) && !/^user story:/i.test(a.task)
  );
  if (uniqueTickets.length > 0) {
    const shown = uniqueTickets.slice(0, 6);
    const more = uniqueTickets.length - shown.length;
    const list = speakList(shown);
    const tally = spellCount(uniqueTickets.length);
    return `Outstanding work (${tally}): ${list}${more > 0 ? `, +${more} more` : ""}.`;
  }
  if (waitingActions.length > 0) {
    const shown = waitingActions.slice(0, 4).map((a) => shorten(a.task, 8));
    const more = waitingActions.length - shown.length;
    return `Outstanding work (${spellCount(waitingActions.length)}): ${speakList(shown)}${more > 0 ? `, +${more} more` : ""}.`;
  }
  return "";
}
function withinBudget(clauses) {
  let out = "";
  for (const clause of clauses) {
    const next = out === "" ? clause : `${out} ${clause}`;
    if (wordCount(next) > LIMITS.maxSnapshotWords) break;
    out = next;
  }
  return out;
}
function hookLine(input) {
  const costly = input.risks.find((r) => r.consequence !== void 0 && r.severity === "high") ?? input.risks.find((r) => r.consequence !== void 0);
  if (costly) {
    return `Primary problem: ${decapitalize(shorten(costly.risk, 14))}.`;
  }
  const committed = input.decisions.find((d) => d.commitment !== "considered" && d.status === "approved") ?? input.decisions.find((d) => d.commitment !== "considered");
  if (committed) {
    return `Primary goal: ${decapitalize(shorten(committed.text, 16))}.`;
  }
  return "";
}
function readingMinutes(input) {
  const words = input.signals.length * 12 + input.decisions.length * 18 + input.risks.length * 22 + input.timeline.length * 12 + input.actions.length * 12 + 80;
  return Math.max(1, Math.round(words / 230));
}
function recallHeading(title, intent) {
  const clean = unpunctuated(title);
  if (clean.length > 0) return sentenceCase(clean);
  return sentenceCase(`${KIND_NOUN[intent.kind]} ${intent.subject}`.trim());
}
var EXPLICIT_ANCHOR = /\b(?:as of|dated|date[:\s]|prepared.*?·|letterhead)\s*([A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Z][a-z]{2,8}\s+\d{4})/i;
var ISO_OR_FULL = /\b((?:19|20)\d{2}-\d{2}-\d{2}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},?\s+\d{4})\b/i;
var RELATIVE_ONLY = /^(?:today|tomorrow|yesterday|tonight|(?:this|next|last)\s+(?:week|month|quarter|year)|end\s+of\s+(?:the\s+)?(?:week|month|quarter|year)|in\s+\d{1,3}\s+(?:days?|weeks?|months?|years?)|soon|eventually|asap)$/i;
var WEAK_MONTH_ONLY = /^(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?$/i;
var TICKET_ID = /^[A-Z]{2,}-\d+/i;
var PHASE_ORDINAL = /^(?:Phase|Step|Stage|Task)\s+[A-Z0-9]+$/i;
var DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function isRealCalendarDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1990 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  const isLeap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const maxDay = month === 2 && isLeap ? 29 : DAYS_IN_MONTH[month - 1];
  return maxDay !== void 0 && day >= 1 && day <= maxDay;
}
function findAnchorDate(text, filename) {
  const explicit = EXPLICIT_ANCHOR.exec(text);
  if (explicit?.[1]) {
    return { value: explicit[1].trim(), confidence: "high", source: "explicit" };
  }
  const fileDate = filename ? /(\d{4}-\d{2}-\d{2}|\d{8})/.exec(filename) : null;
  if (fileDate?.[1]) {
    const raw = fileDate[1];
    const value = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
    if (isRealCalendarDate(value)) {
      return { value, confidence: "medium", source: "filename" };
    }
  }
  const body = ISO_OR_FULL.exec(text);
  if (body?.[1]) {
    return { value: body[1].trim(), confidence: "medium", source: "body" };
  }
  return { value: null, confidence: "none", source: "none" };
}
function gateTimelineEntries(entries, archetype, anchor) {
  if (archetype.timelineMode === "none" && archetype.suppressWeakTimeline) {
    const kept2 = [];
    const demoted2 = [];
    for (const entry of entries) {
      if (isHardDate(entry.date) && !isRelativeOnly(entry.date)) {
        kept2.push(entry);
      } else {
        demoted2.push(`${entry.date}: ${entry.title}`);
      }
    }
    return { timeline: kept2, demoted: demoted2 };
  }
  if (archetype.timelineMode === "single_leg") {
    const chosen = projectSingleLegTimeline(entries);
    const demoted2 = entries.filter((e) => !chosen.includes(e)).map((e) => `${e.date}: ${e.title}`);
    return { timeline: chosen, demoted: demoted2 };
  }
  const kept = [];
  const demoted = [];
  for (const entry of entries) {
    if (shouldKeepTimelineEntry(entry, anchor, archetype)) {
      kept.push(entry);
    } else {
      demoted.push(`${entry.date}: ${entry.title}`);
    }
  }
  return { timeline: kept, demoted };
}
function shouldKeepTimelineEntry(entry, _anchor, archetype) {
  const date = entry.date.trim();
  if (TICKET_ID.test(date) || PHASE_ORDINAL.test(date)) {
    return archetype.timelineMode === "milestone_chain" || archetype.timelineMode === "narrative_sequence";
  }
  if (isRelativeOnly(date)) {
    if (archetype.suppressWeakTimeline || archetype.timelineMode === "none") return false;
    return true;
  }
  if (WEAK_MONTH_ONLY.test(date)) {
    return !archetype.suppressWeakTimeline;
  }
  return true;
}
function isRelativeOnly(date) {
  return RELATIVE_ONLY.test(date.trim());
}
function isHardDate(date) {
  const d = date.trim();
  if (TICKET_ID.test(d)) return false;
  if (PHASE_ORDINAL.test(d)) return false;
  if (isRelativeOnly(d)) return false;
  return /^\d{4}-\d{2}-\d{2}/.test(d) || /\b(?:19|20)\d{2}\b/.test(d) || /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(d) || /^Q[1-4]/i.test(d) || /^H[12]/i.test(d);
}
var ROLE_PATTERNS = [
  { role: "abstract", pattern: /\babstract\b/i },
  { role: "introduction", pattern: /\b(introduction|background|related\s+work)\b/i },
  { role: "hypothesis", pattern: /\b(hypothesis|research\s+questions?|problem\s+statement)\b/i },
  { role: "method", pattern: /\b(method(?:ology)?|methods|experimental\s+setup|experiments?)\b/i },
  { role: "results", pattern: /\b(results?|findings?|evaluation)\b/i },
  { role: "discussion", pattern: /\bdiscussion\b/i },
  { role: "conclusion", pattern: /\bconclusions?\b/i },
  { role: "limitations", pattern: /\blimitations?\b/i },
  { role: "future", pattern: /\b(future\s+work|further\s+work|future\s+(?:research|directions?))\b/i },
  { role: "references", pattern: /\breferences?\b/i }
];
var META_OPENERS = /^(this\s+paper|the\s+paper|this\s+work|we\s+(?:present|propose|introduce|describe|report)|in\s+this\s+(?:paper|work))\b/i;
var METRIC_RE = /\b(?:\d+(?:\.\d+)?%|\d+(?:\.\d+)?\s*(?:points?|pts?|ms|s|×|x|f1|accuracy|recall|precision|bleu|rouge)|(?:f1|accuracy|recall|precision)\s*(?:of|=|:)?\s*\d)/i;
var EXPLICIT_LIMIT_RE = /\b(limited\s+to|only\s+(?:evaluated|tested|studied)|untested|do\s+not\s+(?:evaluate|consider|claim)|single\s+dataset|default\s+(?:hyper)?parameters?|api\s+cost|cost\s+constraints?|we\s+(?:did|do)\s+not)\b/i;
var FUTURE_RE = /\b(future\s+work|further\s+work|should\s+(?:evaluate|explore|investigate|consider)|we\s+(?:plan|aim|hope)\s+to|next\s+steps?|promising\s+directions?)\b/i;
var GAP_RE = /\b(little\s+(?:is\s+)?known|gap|however|despite|remains?\s+(?:unclear|open)|prior\s+work|existing\s+work|previous\s+work|not\s+(?:well\s+)?understood|under[\s-]?explored)\b/i;
function clamp(text, max = LIMITS.maxFieldLength) {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}\u2026`;
}
function dehyphenate(text) {
  return text.replace(/([A-Za-z])\u00AD([a-z])/g, "$1$2").replace(/([A-Za-z])-\s+([a-z])/g, "$1$2");
}
function stripCitations(text) {
  return text.replace(/\s*\[(?:[A-Z][A-Za-z-]+(?:\s+et\s+al\.)?,?\s*\d{4}(?:[a-z])?(?:\s*;\s*[^\\\]]{0,80})?)\]/g, "").replace(/\s*\((?:[A-Z][A-Za-z-]+(?:\s+et\s+al\.)?,?\s*\d{4}(?:[a-z])?(?:\s*;\s*[^)]{0,80})?)\)/g, "").replace(/\s*\[\d+(?:\s*[,–-]\s*\d+)*\]/g, "").replace(/\s{2,}/g, " ").trim();
}
var STOP_OPENERS = /^(whether|when|where|while|what|which|whose|how|why|for|and|but|yet|also|still|thus|hence|here|there|these|those|this|that|with|from|into|onto|over|under|after|before|about|above|below|such|each|both|most|many|some|more|less|only|even|just|not|no|yes|on|of|in|at|to|vs|via|by|as|or|the|a|an)$/i;
function looksLikeWordStump(token) {
  const t = token.replace(/[^A-Za-z]/g, "");
  if (t.length < 2 || t.length > 8) return false;
  if (STOP_OPENERS.test(t)) return false;
  if (!/[aeiouy]/i.test(t)) return true;
  return /^(rmance|formance|nance|tance|tion|sion|ment|ness|ting|cial|ical|trole|sults|nificant|tured)$/i.test(
    t
  );
}
function isGarbledProse(text) {
  const s = text.trim();
  if (!s) return true;
  const first = (s.split(/\s+/)[0] ?? "").replace(/[^A-Za-z']/g, "");
  if (/^[a-z]/.test(s) && first.length <= 8 && !STOP_OPENERS.test(first)) return true;
  if (looksLikeWordStump(first)) return true;
  if (/\(\d+$/.test(s) || /\b\d+\s*[-–—]\s*$/.test(s)) return true;
  if (/[A-Za-z]-\s+[a-z]/.test(s)) return true;
  if (/\[[^\]]{0,40}\b(?:The|We|This|Our|In|A)\b/.test(s)) return true;
  if (/\b(?:et\s+al\.,?\s*){0,1}\d{4}\]\s*[A-Z][a-z]/.test(s)) return true;
  if (wordCount(s) < 8 && !/[.!?]$/.test(s) && /^[a-z]/.test(s)) return true;
  const words = s.split(/\s+/);
  const tiny = words.filter((w) => /^[A-Za-z]{1,2}$/.test(w)).length;
  if (words.length >= 8 && tiny / words.length > 0.35) return true;
  return false;
}
function isGarbledLabel(label) {
  const s = label.trim();
  if (!s || s.length < 3) return true;
  if (/\(\d+$/.test(s) || /\b\d+\s*[-–—]\s*$/.test(s)) return true;
  const first = (s.split(/\s+/)[0] ?? "").replace(/[^A-Za-z']/g, "");
  if (looksLikeWordStump(first)) return true;
  if (/^[A-Za-z]\s+\w+/.test(s)) return true;
  if (/^[a-z]/.test(s) && !STOP_OPENERS.test(first)) return true;
  return false;
}
function cleanResearchSentence(text) {
  return stripCitations(dehyphenate(text.replace(/\s+/g, " ").trim()));
}
function claimScore(sentence) {
  let score = 0;
  const s = sentence.toLowerCase();
  const wc = wordCount(sentence);
  if (wc >= 10 && wc <= 45) score += 2;
  else if (wc >= 8) score += 1;
  if (/[.!?]$/.test(sentence)) score += 1;
  if (/\b(show|shows|showed|demonstrate|demonstrates|suggest|suggests|indicate|outperform|improve|fail|fails|bottleneck|only|consistently|significantly|marginal|minimal improvements?)\b/.test(
    s
  )) {
    score += 3;
  }
  if (/\b(f1|precision|recall|prompting strateg|zero-shot|few-shot|reflection|argument (?:role|text)|event type)\b/.test(s)) {
    score += 3;
  }
  if (/\b(recent work|prior work|previous work|existing (?:methods?|approaches?|work)|studies have shown|research on\b|work on\b|literature|has similarly found|contributes to this literature)\b/.test(
    s
  )) {
    score -= 5;
  }
  if (/\b(we\s+(?:evaluate|compare|use|conduct|employ|present|propose))\b/.test(s)) {
    score -= 1;
  }
  if (isMetricHeavy(sentence)) score -= 1;
  if (isGarbledProse(sentence)) score -= 10;
  return score;
}
function classifyResearchRole(heading) {
  if (!heading) return "other";
  for (const { role, pattern } of ROLE_PATTERNS) {
    if (pattern.test(heading)) return role;
  }
  return "other";
}
function linesToSentences(lines) {
  const out = [];
  for (const line of lines) {
    const raw = cleanResearchSentence(plainContentOf(line.text));
    if (!raw) continue;
    const list = splitListItem(raw);
    const body = list?.text ?? raw;
    for (const sentence of splitSentences(body)) {
      const s = cleanResearchSentence(sentence);
      if (wordCount(s) < 6) continue;
      if (isGarbledProse(s)) continue;
      out.push(s);
    }
  }
  return out;
}
function summarizeSection(section) {
  const role = classifyResearchRole(section.headingText);
  const sentences = linesToSentences(section.lines);
  const summary = clamp(sentences.slice(0, 3).join(" "), 480);
  const first = section.lines[0]?.lineNo;
  const last = section.lines[section.lines.length - 1]?.lineNo ?? first;
  const lineRange = first == null ? "source" : first === last ? `line ${first}` : `lines ${first}\u2013${last}`;
  return {
    role,
    heading: section.headingText,
    summary,
    sentences,
    lineRange
  };
}
function textsOf(summaries, roles) {
  return summaries.filter((s) => roles.includes(s.role)).flatMap((s) => s.sentences);
}
function stripMetaOpener(sentence) {
  let s = cleanResearchSentence(sentence);
  s = s.replace(META_OPENERS, "").replace(/^[,:\s-]+/, "");
  s = s.replace(/^(?:this\s+work\s+)?addresses\s+a\s+fundamental\s+question:\s*/i, "");
  s = s.replace(/^we\s+(?:study|investigate|examine|ask|test)\s+/i, "");
  s = s.replace(/^whether\s+/i, "Whether ");
  if (isGarbledProse(s)) return s.trim();
  if (s && !/^[A-Z]/.test(s)) s = s.charAt(0).toUpperCase() + s.slice(1);
  return s.trim();
}
function isMetricHeavy(sentence) {
  const metrics = sentence.match(/\d+(?:\.\d+)?%?/g) ?? [];
  if (metrics.length >= 2) return true;
  if (METRIC_RE.test(sentence) && wordCount(sentence) <= 18) return true;
  return false;
}
function qualitativeFinding(sentence) {
  if (isGarbledProse(sentence)) return null;
  if (isMetricHeavy(sentence)) {
    const soft = cleanResearchSentence(
      sentence.replace(/\bwithin\s+\d+(?:\.\d+)?\s*points?\b/gi, "closely").replace(/\bby\s+\d+(?:\.\d+)?%\b/gi, "substantially").replace(/\b\d+(?:\.\d+)?%\b/g, "").replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").trim()
    );
    if (wordCount(soft) < 6 || isGarbledProse(soft)) return null;
    return clamp(soft);
  }
  if (META_OPENERS.test(sentence)) return null;
  const finding = stripMetaOpener(sentence);
  if (!finding || isGarbledProse(finding) || wordCount(finding) < 6) return null;
  return clamp(finding);
}
function metricLabelFromBefore(before) {
  let s = before.replace(/\s+/g, " ").trim();
  s = s.replace(/[\s(\[:\-–—,;]+$/g, "").trim();
  s = s.replace(
    /^(?:results?\s+)?(?:demonstrate|show|shows|showed|achieve|achieves|report|reports)\s+/i,
    ""
  );
  s = s.replace(/^(?:strong|modest|weak|high|low|extreme)\s+/i, "");
  s = s.replace(/\b(?:particularly|especially|namely)\s+/i, "");
  const words = s.split(/\s+/).filter(Boolean);
  while (words.length > 0) {
    const head = words[0].replace(/[^A-Za-z]/g, "");
    if (looksLikeWordStump(head) || /^[a-z]/.test(words[0]) && !STOP_OPENERS.test(words[0])) {
      words.shift();
      continue;
    }
    break;
  }
  const slice = words.slice(-6);
  let label = slice.join(" ").replace(/\s*\(\s*$/g, "").trim();
  label = label.replace(/^(?:on|of|for|in|at|to|with)\s+/i, "").trim();
  if (!label) return "Measured result";
  if (!/^[A-Z]/.test(label)) label = label.charAt(0).toUpperCase() + label.slice(1);
  if (isGarbledLabel(label)) return "Measured result";
  return clamp(label, 72);
}
function extractMetrics(sentence) {
  const entries = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (label, value) => {
    const key = `${label.toLowerCase()}|${value}`;
    if (seen.has(key)) return;
    if (isGarbledLabel(label)) return;
    seen.add(key);
    entries.push({
      label,
      value,
      implication: clamp(cleanResearchSentence(sentence), 220)
    });
  };
  const rangeRe = /(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)%\s*(F1|accuracy|recall|precision)?/gi;
  const covered = /* @__PURE__ */ new Set();
  for (const m of sentence.matchAll(rangeRe)) {
    const idx = m.index ?? 0;
    for (let i = idx; i < idx + m[0].length; i++) covered.add(i);
    const unit = m[3] ? ` ${m[3]}` : "";
    const value = `${m[1]}\u2013${m[2]}%${unit}`.replace(/\s+/g, " ");
    const label = metricLabelFromBefore(sentence.slice(0, idx));
    push(label === "Measured result" && m[3] ? `${m[3]} range` : label, value);
    if (entries.length >= 4) return entries;
  }
  const singleRe = /(\d+(?:\.\d+)?)%/gi;
  for (const m of sentence.matchAll(singleRe)) {
    const idx = m.index ?? 0;
    if (covered.has(idx)) continue;
    const label = metricLabelFromBefore(sentence.slice(0, idx));
    push(label, m[0]);
    if (entries.length >= 4) return entries;
  }
  const points = [...sentence.matchAll(/within\s+(\d+(?:\.\d+)?)\s*points?/gi)];
  for (const m of points.slice(0, 2)) {
    push("Gap vs baseline", `${m[1]} points`);
  }
  if (entries.length === 0 && METRIC_RE.test(sentence)) {
    const raw = (sentence.match(/\d+(?:\.\d+)?%?/) ?? ["see source"])[0];
    push("Measured result", raw);
  }
  return entries;
}
function inferResearchQuestion(summaries, title) {
  const pool = textsOf(summaries, ["abstract", "introduction", "hypothesis"]).filter(
    (s) => !isGarbledProse(s)
  );
  const QUESTION_LIKE = /\b(fundamental question|research question|what is the efficacy|can (?:general[- ]purpose )?llms?|we (?:study|investigate|examine|ask|focus|test|evaluate) whether)\b/i;
  const clean = (s, max = 220) => {
    const t = stripMetaOpener(s);
    return isGarbledProse(t) ? "" : clamp(t, max);
  };
  const questionLike = pool.find((s) => QUESTION_LIKE.test(s) && !isGarbledProse(stripMetaOpener(s)));
  const whether = pool.find(
    (s) => (/\bwhether\b/i.test(s) || /\bwe\s+(?:study|investigate|examine|test)\b/i.test(s)) && !isGarbledProse(stripMetaOpener(s))
  );
  const gap = pool.find(
    (s) => GAP_RE.test(s) && !isGarbledProse(stripMetaOpener(s)) && /\b(llm|prompt|extract|evaluat|systematic|general[- ]purpose)\b/i.test(s)
  );
  const hypothesis = textsOf(summaries, ["hypothesis"]).find((s) => !isGarbledProse(s)) ?? pool.find((s) => /\bhypothes/i.test(s) && !isGarbledProse(s));
  const questionCore = questionLike ? clean(questionLike, 320) : whether ? clean(whether, 320) : gap ? clean(gap, 320) : pool.find((s) => claimScore(s) >= 2) ? clean(pool.find((s) => claimScore(s) >= 2), 320) : `What does \u201C${title}\u201D actually establish?`;
  const parts = [];
  if (gap && (questionLike || whether) && gap !== questionLike && gap !== whether) {
    const g = clean(gap, 220);
    const w = clean(questionLike ?? whether ?? "", 220);
    if (g) parts.push(g);
    if (w) parts.push(`The work tests ${w.replace(/^Whether\s+/i, "whether ")}`);
  } else if (questionCore) {
    parts.push(questionCore);
  }
  if (hypothesis && hypothesis !== whether && hypothesis !== gap && hypothesis !== questionLike) {
    const h = clean(hypothesis, 220);
    if (h) parts.push(`Hypothesis under test: ${h}`);
  }
  const summary = parts.length > 0 ? clamp(parts.join(" "), LIMITS.maxFieldLength) : questionCore;
  const problem = gap ? clean(gap) || void 0 : void 0;
  const goal = hypothesis ? clean(hypothesis) || void 0 : questionLike ? clean(questionLike) || void 0 : whether ? clean(whether) || void 0 : void 0;
  return {
    summary: summary || `What does \u201C${title}\u201D actually establish?`,
    problem,
    goal,
    hook: questionCore || void 0
  };
}
function isTableDump(sentence) {
  const s = sentence.trim();
  if (!s) return true;
  if (s.includes("|")) return true;
  if (/^\s*\|?\s*:?-{3,}/.test(s)) return true;
  const nums = s.match(/\d+(?:\.\d+)?/g) || [];
  if (nums.length >= 4 && wordCount(s) <= nums.length + 6) return true;
  return false;
}
function inferKeyFindings(summaries) {
  const pool = textsOf(summaries, ["results", "discussion", "conclusion", "abstract"]).filter(
    (sentence) => !/\b(recent work|prior work|previous work|contributes to this literature|work on biomedical|research on information extraction has found)\b/i.test(
      sentence
    )
  );
  const ranked = pool.filter((sentence) => !isTableDump(sentence)).filter(
    (sentence) => !/^we\s+(?:use|compare|conduct|employ|evaluate|focus|test four|present)\b/i.test(sentence)
  ).filter((sentence) => !isGarbledProse(sentence)).map((sentence) => ({ sentence, score: claimScore(sentence) })).filter((row) => row.score >= 2).sort((a, b) => b.score - a.score);
  const findings = [];
  for (const { sentence } of ranked) {
    const finding = qualitativeFinding(sentence);
    if (!finding) continue;
    if (isTableDump(finding) || isGarbledProse(finding)) continue;
    if (findings.some((f) => f.title.toLowerCase() === finding.toLowerCase())) continue;
    if (findings.some((f) => {
      const a = f.title.toLowerCase().slice(0, 48);
      const b = finding.toLowerCase().slice(0, 48);
      return a.includes(b.slice(0, 24)) || b.includes(a.slice(0, 24));
    })) {
      continue;
    }
    findings.push({ date: "Finding", title: finding, state: "done" });
    if (findings.length >= Math.min(8, LIMITS.maxEntriesPerBlock)) break;
  }
  return findings;
}
function inferEvidence(summaries) {
  const pool = textsOf(summaries, ["results", "method", "abstract", "hypothesis"]);
  const evidence = [];
  let setupCount = 0;
  for (const sentence of pool) {
    if (isGarbledProse(sentence)) continue;
    if (isTableDump(sentence)) {
      for (const entry of extractMetrics(sentence)) {
        if (isGarbledLabel(entry.label) || isGarbledProse(entry.implication ?? "")) continue;
        if (evidence.some((e) => e.label === entry.label && e.value === entry.value)) continue;
        evidence.push({
          ...entry,
          label: clamp(entry.label.replace(/\|/g, " ").trim() || "Table metric", 120)
        });
        if (evidence.length >= 8) return evidence;
      }
      continue;
    }
    if (METRIC_RE.test(sentence)) {
      for (const entry of extractMetrics(sentence)) {
        if (isGarbledLabel(entry.label) || isGarbledProse(entry.implication ?? "")) continue;
        if (evidence.some((e) => e.label === entry.label && e.value === entry.value)) continue;
        if (evidence.some(
          (e) => e.implication && entry.implication && e.implication.toLowerCase().slice(0, 80) === entry.implication.toLowerCase().slice(0, 80)
        )) {
          continue;
        }
        evidence.push(entry);
        if (evidence.length >= 8) return evidence;
      }
    }
    if (setupCount < 1 && /\bdataset\b|\b\d+k[\s-]?token|\bprompting strateg/i.test(sentence) && evidence.length < 8) {
      const implication = clamp(cleanResearchSentence(sentence), 160);
      if (isGarbledProse(implication) || wordCount(implication) < 6) continue;
      evidence.push({
        label: "Experimental setup",
        implication
      });
      setupCount++;
    }
  }
  return evidence;
}
function inferInsights(summaries, findings) {
  const interpretive = textsOf(summaries, ["discussion", "conclusion", "results"]).filter(
    (s) => /\b(suggests?|indicates?|implies?|shows? that|means that|rather than|bottleneck|however|surprising)/i.test(
      s
    ) || !isMetricHeavy(s) && !META_OPENERS.test(s)
  );
  const findingsBlob = findings.map((f) => f.title.toLowerCase()).join("\n");
  const relatedWorkChrome = /\b(recent work|prior work|previous work|existing (?:methods?|approaches?)|studies have shown|research on\b|work on\b)\b/i;
  const insights = [];
  const push = (text) => {
    const t = clamp(stripMetaOpener(text));
    if (wordCount(t) < 6) return;
    if (isTableDump(t)) return;
    if (findingsBlob.includes(t.toLowerCase())) return;
    if (relatedWorkChrome.test(t) && !/\b(suggests?|implies?|means that|bottleneck)\b/i.test(t)) return;
    if (insights.some((i) => i.text.toLowerCase() === t.toLowerCase())) return;
    insights.push({ text: t, status: "proposed", commitment: "considered" });
  };
  const rankedInsights = interpretive.filter((s) => !isMetricHeavy(s) && !isTableDump(s) && !isGarbledProse(s)).map((s) => ({ s, score: claimScore(s) })).filter((row) => row.score >= 2).sort((a, b) => b.score - a.score);
  for (const { s } of rankedInsights) {
    push(s);
    if (insights.length >= 4) break;
  }
  const blob = [
    ...findings.map((f) => f.title),
    ...textsOf(summaries, ["abstract", "hypothesis", "results", "discussion", "conclusion"])
  ].join(" ");
  if (/\b(latency|compute|inference\s+time|sparse|dense|recall|quality)\b/i.test(blob)) {
    if (/\bsparse\b/i.test(blob) && /\b(recall|quality)\b/i.test(blob) && /\b(latency|compute|time)\b/i.test(blob)) {
      push(
        "The practical win is efficiency under preserved quality \u2014 sparsity helps when recall stays near the dense baseline."
      );
    }
  }
  if (/\b(prompt|few[\s-]?shot|reflection|zero[\s-]?shot)\b/i.test(blob) && /\b(span|localiz|ground|argument|extract)\b/i.test(blob)) {
    push("The bottleneck is localization/grounding rather than semantic understanding alone.");
  }
  if (/\b(minimal|marginal|little)\b/i.test(blob) && /\b(prompt|few[\s-]?shot|reflection|zero[\s-]?shot)\b/i.test(blob)) {
    push("Advanced prompting strategies add little over zero-shot for fine-grained scientific extraction.");
  }
  if (/\bhallucin/i.test(blob) && /\b(over[\s-]?general|span|extract)\b/i.test(blob)) {
    push("Failures cluster around hallucination, over-generalization, and imprecise span boundaries.");
  }
  return insights.slice(0, LIMITS.maxEntriesPerBlock);
}
var LIMIT_INTRO = /\b(several limitations|limitations that should|should be considered when interpreting|when interpreting results)\b/i;
function inferLimitations(summaries) {
  const limitSummaries = summaries.filter((s) => s.role === "limitations");
  const pool = [
    ...limitSummaries.flatMap((s) => s.sentences),
    ...textsOf(summaries, ["discussion", "conclusion"]).filter((s) => EXPLICIT_LIMIT_RE.test(s))
  ].filter((s) => !isGarbledProse(s) && !LIMIT_INTRO.test(s));
  const buckets = [];
  let current = null;
  const themeRe = /^([A-Z][A-Za-z0-9][A-Za-z0-9 /-]{1,40}):\s*(.+)$/;
  for (const sentence of pool) {
    const fromLimitSection = limitSummaries.some((s) => s.sentences.includes(sentence));
    if (!fromLimitSection && !EXPLICIT_LIMIT_RE.test(sentence)) continue;
    if (/\bhallucin/i.test(sentence) && !fromLimitSection) continue;
    const themed = themeRe.exec(sentence.trim());
    if (themed) {
      current = { theme: themed[1].trim(), claims: [themed[2].trim()] };
      buckets.push(current);
      continue;
    }
    if (current && fromLimitSection) {
      if (wordCount(sentence) >= 5) current.claims.push(sentence.trim());
      continue;
    }
    const title = guessLimitationTheme(sentence);
    current = { theme: title, claims: [stripMetaOpener(sentence)] };
    buckets.push(current);
  }
  const out = [];
  for (const bucket of buckets) {
    const synthesized = synthesizeLimitation(bucket.theme, bucket.claims);
    if (!synthesized || isGarbledProse(synthesized) || wordCount(synthesized) < 4) continue;
    if (out.some((r) => r.risk.toLowerCase() === synthesized.toLowerCase())) continue;
    if (out.some((r) => r.risk.toLowerCase().startsWith(bucket.theme.toLowerCase()))) continue;
    out.push({ risk: synthesized });
    if (out.length >= 6) break;
  }
  return out;
}
function guessLimitationTheme(sentence) {
  if (/\bdataset|single domain|one domain|generalization\b/i.test(sentence)) return "Dataset Scope";
  if (/\bprompt/i.test(sentence)) return "Prompting Strategies";
  if (/\btemperature|top-p|hyperparameter|default (?:api )?parameters?|sampling\b/i.test(sentence)) {
    return "Model Configuration";
  }
  if (/\bcost|api|compute|budget|inference pass/i.test(sentence)) return "Computational Constraints";
  if (/\blanguage|english|multilingual\b/i.test(sentence)) return "Language Coverage";
  return "Limitation";
}
function synthesizeLimitation(theme, claims) {
  const cleaned = claims.map((c) => cleanResearchSentence(c)).filter((c) => wordCount(c) >= 4 && !LIMIT_INTRO.test(c));
  if (cleaned.length === 0) return "";
  const core = clamp(cleaned[0], 130).replace(/\.$/, "");
  let detail = "";
  if (cleaned[1]) {
    detail = clamp(
      cleaned[1].replace(/^(while|although|however|though|this)\s+/i, ""),
      90
    ).replace(/\.$/, "");
  }
  const body = detail ? `${core}; ${detail.charAt(0).toLowerCase()}${detail.slice(1)}` : core;
  if (theme === "Limitation") return clamp(`${body}.`, 220);
  const rest = body.charAt(0).toLowerCase() + body.slice(1);
  return clamp(`${theme} \u2014 ${rest}.`, 220);
}
function inferFutureDirections(summaries) {
  const pool = [
    ...textsOf(summaries, ["future"]),
    ...textsOf(summaries, ["conclusion"]).filter((s) => FUTURE_RE.test(s) || /^(evaluate|explore|investigate)\b/i.test(s))
  ];
  const out = [];
  for (const sentence of pool) {
    if (/\?$/.test(sentence) && !FUTURE_RE.test(sentence)) continue;
    let task = stripMetaOpener(sentence);
    task = task.replace(/^(future\s+work\s*[:.]?\s*)/i, "");
    task = clamp(task);
    if (wordCount(task) < 4) continue;
    if (out.some((a) => a.task.toLowerCase() === task.toLowerCase())) continue;
    out.push({ task, status: "suggested" });
    if (out.length >= LIMITS.maxEntriesPerBlock) break;
  }
  return out;
}
function provenanceFor(label, summaries, roles, excerpt) {
  const hit = summaries.find((s) => roles.includes(s.role) && s.summary);
  return {
    method: "local-parser",
    label,
    locator: hit ? `section \u201C${hit.heading ?? hit.role}\u201D \xB7 ${hit.lineRange} \xB7 cross-section research model` : "cross-section research model",
    excerpt: clamp(excerpt || hit?.summary || "research world model", 240)
  };
}
function buildResearchWorldModel(input) {
  const summaries = input.sections.filter((s) => s.lines.some((l) => l.text.trim() !== "") || s.headingText).map(summarizeSection).filter((s) => s.role !== "references");
  const question = inferResearchQuestion(summaries, input.title);
  const findings = inferKeyFindings(summaries);
  const evidence = inferEvidence(summaries);
  const insights = inferInsights(summaries, findings);
  const limitations = inferLimitations(summaries);
  const future = inferFutureDirections(summaries);
  const built = /* @__PURE__ */ new Map();
  built.set("snapshot", {
    kind: "snapshot",
    payload: {
      heading: clamp(input.title, LIMITS.maxFieldLength),
      summary: question.summary,
      ...question.hook ? { hook: question.hook } : {},
      ...question.goal ? { goal: question.goal } : {},
      ...question.problem ? { problem: question.problem } : {},
      byline: "Inferred research question \xB7 not a paper paraphrase"
    },
    provenance: provenanceFor(input.label, summaries, ["abstract", "introduction", "hypothesis"], question.summary)
  });
  built.set("timeline", {
    kind: "timeline",
    payload: { entries: findings },
    provenance: provenanceFor(
      input.label,
      summaries,
      ["results", "discussion"],
      findings[0]?.title ?? "key findings"
    )
  });
  built.set("signals", {
    kind: "signals",
    payload: { entries: evidence },
    provenance: provenanceFor(input.label, summaries, ["results", "method"], evidence[0]?.implication ?? "evidence")
  });
  built.set("decisions", {
    kind: "decisions",
    payload: { entries: insights },
    provenance: provenanceFor(
      input.label,
      summaries,
      ["discussion", "conclusion", "results"],
      insights[0]?.text ?? "insights"
    )
  });
  built.set("risks", {
    kind: "risks",
    payload: { entries: limitations },
    provenance: provenanceFor(input.label, summaries, ["limitations"], limitations[0]?.risk ?? "limitations")
  });
  built.set("actions", {
    kind: "actions",
    payload: { entries: future },
    provenance: provenanceFor(input.label, summaries, ["future", "conclusion"], future[0]?.task ?? "future directions")
  });
  return built;
}
var ROLE_PATTERNS2 = [
  { role: "abstract", pattern: /\babstract\b/i },
  { role: "introduction", pattern: /\b(introduction|background|related\s+work)\b/i },
  { role: "hypothesis", pattern: /\b(hypothesis|research\s+questions?|problem\s+statement)\b/i },
  { role: "method", pattern: /\b(method(?:ology)?|methods|experimental\s+setup|experiments?)\b/i },
  { role: "results", pattern: /\b(results?|findings?|evaluation)\b/i },
  { role: "discussion", pattern: /\bdiscussion\b/i },
  { role: "conclusion", pattern: /\bconclusions?\b/i },
  { role: "limitations", pattern: /\blimitations?\b/i },
  { role: "future", pattern: /\b(future\s+work|further\s+work|future\s+(?:research|directions?))\b/i },
  { role: "references", pattern: /\breferences?\b/i }
];
var METRIC_RE2 = /\b(?:\d+(?:\.\d+)?%|\d+(?:\.\d+)?\s*(?:points?|pts?|ms|s|×|x|f1|accuracy|recall|precision)|(?:f1|accuracy|recall|precision)\s*(?:of|=|:)?\s*\d)/i;
var LIMIT_RE = /\b(limited\s+to|only\s+(?:evaluated|tested|studied)|untested|single\s+dataset|we\s+(?:did|do)\s+not|cost\s+constraints?)\b/i;
var FUTURE_RE2 = /\b(future\s+work|further\s+work|should\s+(?:evaluate|explore|investigate)|we\s+(?:plan|aim|hope)\s+to|next\s+steps?)\b/i;
var GAP_RE2 = /\b(little\s+(?:is\s+)?known|gap|however|despite|remains?\s+(?:unclear|open)|not\s+(?:well\s+)?understood|under[\s-]?explored)\b/i;
var CITATION_RE = /\[(\d{1,3}(?:\s*[,–-]\s*\d{1,3})*)\]|\((?:[A-Z][a-z]+(?:\s+et\s+al\.)?,?\s*)+\d{4}[a-z]?\)/g;
function nid(kind, label) {
  return `${kind}_${sha256Hex(`${kind}:${label.toLowerCase()}`).slice(0, 12)}`;
}
function roleOf(heading) {
  if (!heading) return "other";
  for (const { role, pattern } of ROLE_PATTERNS2) {
    if (pattern.test(heading)) return role;
  }
  return "other";
}
function sentencesOf(section) {
  const out = [];
  for (const line of section.lines) {
    const raw = plainContentOf(line.text).trim();
    if (!raw) continue;
    const list = splitListItem(raw);
    const body = list?.text ?? raw;
    for (const sentence of splitSentences(body)) {
      const s = sentence.replace(/\s+/g, " ").trim();
      if (wordCount(s) < 4) continue;
      out.push(s);
    }
  }
  return out;
}
function degreeAnalysis(nodes, edges) {
  const degree = /* @__PURE__ */ new Map();
  const labels = new Map(nodes.map((n) => [n.id, n.label]));
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const god = [...degree.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, d]) => ({ id, label: labels.get(id) ?? id, degree: d }));
  return {
    god_nodes: god,
    surprising_connections: edges.filter((e) => e.confidence === "INFERRED").slice(0, 12).map((e) => ({
      source: e.source,
      target: e.target,
      relation: e.relation,
      confidence: e.confidence
    })),
    suggested_questions: [
      "Which metrics most strongly support the key findings?",
      "What limitations qualify the strongest claims?",
      "Which research gap do the results actually close?"
    ]
  };
}
function buildResearchKnowledgeGraph(input) {
  const nodes = [];
  const edges = [];
  const nodeIds = /* @__PURE__ */ new Set();
  const byEntityKey = /* @__PURE__ */ new Map();
  const entityKey = (kind, label) => `${kind || "node"}::${label.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120)}`;
  const addNode = (node) => {
    const key = entityKey(node.kind, node.label);
    const existing = byEntityKey.get(key);
    if (existing) return existing;
    if (nodeIds.has(node.id)) {
      byEntityKey.set(key, node.id);
      return node.id;
    }
    nodeIds.add(node.id);
    byEntityKey.set(key, node.id);
    nodes.push(node);
    return node.id;
  };
  const addEdge = (edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return;
    if (edges.some((e) => e.source === edge.source && e.target === edge.target && e.relation === edge.relation)) {
      return;
    }
    edges.push(edge);
  };
  const paperId = addNode({
    id: nid("paper", input.title),
    label: input.title,
    kind: "paper",
    source_file: input.label,
    source_location: "title"
  });
  const claimPool = [];
  for (const section of input.sections) {
    const role = roleOf(section.headingText);
    if (role === "references") continue;
    const hasBody = section.lines.some((l) => l.text.trim());
    if (!section.headingText && !hasBody) continue;
    const label = section.headingText ?? role;
    const first = section.lines[0]?.lineNo;
    const loc = first != null ? `L${first}` : role;
    const sid = addNode({
      id: nid("section", `${role}:${label}`),
      label,
      kind: "section",
      role,
      source_file: input.label,
      source_location: loc
    });
    addEdge({ source: paperId, target: sid, relation: "contains", confidence: "EXTRACTED" });
    for (const sentence of sentencesOf(section).slice(0, 24)) {
      if (sentence.includes("|") || /^\s*[\w.-]+\s+(\d+(\.\d+)?\s+){3,}/.test(sentence) && wordCount(sentence) < 20) {
        continue;
      }
      let kind = "claim";
      let relation = "states";
      if (METRIC_RE2.test(sentence)) {
        kind = "metric";
        relation = "reports";
      } else if (role === "limitations" || LIMIT_RE.test(sentence)) {
        kind = "limitation";
        relation = "bounds";
      } else if (role === "future" || FUTURE_RE2.test(sentence)) {
        kind = "future_work";
        relation = "proposes";
      } else if ((role === "abstract" || role === "introduction" || role === "hypothesis") && GAP_RE2.test(sentence)) {
        kind = "research_gap";
        relation = "motivates";
      }
      const cid = addNode({
        id: nid(kind, sentence.slice(0, 160)),
        label: sentence.slice(0, 160),
        kind,
        source_file: input.label,
        source_location: loc
      });
      addEdge({ source: sid, target: cid, relation, confidence: "EXTRACTED" });
      claimPool.push({ id: cid, role, kind });
      const cites = [...sentence.matchAll(CITATION_RE)].slice(0, 3);
      for (const m of cites) {
        const citeLabel = m[1] ?? m[0];
        const rid = addNode({
          id: nid("citation", citeLabel),
          label: `cite:${citeLabel}`.slice(0, 120),
          kind: "citation",
          source_file: input.label,
          source_location: loc
        });
        addEdge({ source: cid, target: rid, relation: "cites", confidence: "EXTRACTED" });
      }
    }
  }
  const gaps = claimPool.filter((c) => c.kind === "research_gap");
  const qualitativeFindings = claimPool.filter(
    (c) => (c.role === "results" || c.role === "conclusion") && c.kind !== "metric"
  );
  const resultClaims = claimPool.filter((c) => c.role === "results" || c.role === "conclusion");
  const findings = qualitativeFindings.length > 0 ? qualitativeFindings : resultClaims;
  const metrics = claimPool.filter((c) => c.kind === "metric");
  const limitations = claimPool.filter((c) => c.kind === "limitation");
  for (const gap of gaps.slice(0, 3)) {
    for (const finding of findings.slice(0, 4)) {
      addEdge({
        source: gap.id,
        target: finding.id,
        relation: "addressed_by",
        confidence: "INFERRED"
      });
    }
  }
  for (const metric of metrics.slice(0, 6)) {
    for (const finding of findings.slice(0, 4)) {
      if (metric.id === finding.id) continue;
      addEdge({
        source: metric.id,
        target: finding.id,
        relation: "supports",
        confidence: "INFERRED"
      });
    }
    if (findings.every((f) => f.id === metric.id) || qualitativeFindings.length === 0) {
      for (const gap of gaps.slice(0, 2)) {
        addEdge({
          source: gap.id,
          target: metric.id,
          relation: "addressed_by",
          confidence: "INFERRED"
        });
      }
    }
  }
  for (const lim of limitations.slice(0, 4)) {
    for (const finding of findings.slice(0, 3)) {
      addEdge({
        source: lim.id,
        target: finding.id,
        relation: "qualifies",
        confidence: "INFERRED"
      });
    }
  }
  return {
    nodes,
    edges,
    schema: "graphify-v1",
    extractor: "memorable-ts-graphify",
    analysis: degreeAnalysis(nodes, edges)
  };
}
function mergeKnowledgeGraphs(primary, fallback) {
  if (!primary || primary.nodes.length === 0) return dedupeGraphEntities(fallback);
  const nodes = /* @__PURE__ */ new Map();
  for (const n of fallback.nodes) nodes.set(n.id, n);
  for (const n of primary.nodes) nodes.set(n.id, n);
  const edgeKey = (e) => `${e.source}|${e.target}|${e.relation}`;
  const edges = /* @__PURE__ */ new Map();
  for (const e of fallback.edges) edges.set(edgeKey(e), e);
  for (const e of primary.edges) edges.set(edgeKey(e), e);
  const merged = dedupeGraphEntities({
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    schema: "graphify-v1",
    extractor: primary.extractor.includes("graphify") ? primary.extractor : `${primary.extractor}+${fallback.extractor}`,
    analysis: primary.analysis,
    ...primary.graphify_status ? { graphify_status: primary.graphify_status } : {}
  });
  return {
    ...merged,
    analysis: merged.analysis ?? degreeAnalysis(merged.nodes, merged.edges)
  };
}
function dedupeGraphEntities(graph) {
  const idMap = /* @__PURE__ */ new Map();
  const survivors = /* @__PURE__ */ new Map();
  for (const node of graph.nodes) {
    const key = `${node.kind || "node"}::${(node.label || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120)}`;
    const existing = survivors.get(key);
    if (existing) {
      idMap.set(node.id, existing.id);
      continue;
    }
    survivors.set(key, node);
    idMap.set(node.id, node.id);
  }
  const nodes = [...survivors.values()];
  const alive = new Set(nodes.map((n) => n.id));
  const edges = [];
  const seen = /* @__PURE__ */ new Set();
  for (const e of graph.edges) {
    const source = idMap.get(e.source) ?? e.source;
    const target = idMap.get(e.target) ?? e.target;
    if (!alive.has(source) || !alive.has(target) || source === target) continue;
    const key = `${source}|${target}|${e.relation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ ...e, source, target });
  }
  return {
    ...graph,
    nodes,
    edges,
    analysis: degreeAnalysis(nodes, edges)
  };
}
var NOT_APPLICABLE_NOTE = "Not applicable for this document type.";
var GENERIC_KNOWLEDGE_FURNITURE = {
  snapshot: { label: BLOCK_KIND_LABELS.snapshot, subtitle: BLOCK_KIND_SUBTITLES.snapshot },
  signals: { label: BLOCK_KIND_LABELS.signals, subtitle: BLOCK_KIND_SUBTITLES.signals },
  decisions: { label: BLOCK_KIND_LABELS.decisions, subtitle: BLOCK_KIND_SUBTITLES.decisions },
  timeline: { label: BLOCK_KIND_LABELS.timeline, subtitle: BLOCK_KIND_SUBTITLES.timeline },
  risks: { label: BLOCK_KIND_LABELS.risks, subtitle: BLOCK_KIND_SUBTITLES.risks },
  actions: { label: BLOCK_KIND_LABELS.actions, subtitle: BLOCK_KIND_SUBTITLES.actions }
};
var ALL_KINDS = BLOCK_KINDS;
var RESUME_FURNITURE = {
  snapshot: { label: "Profile", subtitle: "Who this person is" },
  signals: { label: "Skills", subtitle: "Capabilities the resume claims" },
  decisions: { label: "Education", subtitle: "Degrees, schools, and certifications" },
  timeline: { label: "Experience", subtitle: "Roles and career timeline" },
  risks: { label: "Achievements", subtitle: "Awards, impact, and highlights" },
  actions: { label: "Projects", subtitle: "Built work and portfolio pieces" }
};
var INVOICE_FURNITURE = {
  snapshot: { label: "Invoice", subtitle: "Who is billing whom" },
  signals: { label: "Line items", subtitle: "Charges, quantities, and unit prices" },
  decisions: { label: "Vendor", subtitle: "Billing party and commercial terms" },
  timeline: { label: "Timeline", subtitle: "Issue date, due date, and payment schedule" },
  risks: { label: "Totals", subtitle: "Subtotal, tax, and amount due" },
  actions: { label: "Payment", subtitle: "How and when to pay" }
};
var RESEARCH_FURNITURE = {
  snapshot: {
    label: "Research Question",
    subtitle: "Inferred gap, assumption, and hypothesis under test"
  },
  signals: {
    label: "Evidence",
    subtitle: "Metrics and measurements that support the findings"
  },
  decisions: {
    label: "Insights",
    subtitle: "Cross-section understanding beyond the wording"
  },
  timeline: {
    label: "Key Findings",
    subtitle: "Synthesized findings \u2014 not raw tables"
  },
  risks: {
    label: "Limitations",
    subtitle: "Explicit bounds stated by the authors"
  },
  actions: {
    label: "Future Directions",
    subtitle: "Where the work should go next"
  }
};
function classicKeep(furniture = GENERIC_KNOWLEDGE_FURNITURE) {
  return {
    furniture,
    applicable: ALL_KINDS,
    required: ALL_KINDS,
    emptyApplicable: "keep",
    overflow: "promote"
  };
}
function selective(opts) {
  return {
    furniture: opts.furniture,
    applicable: opts.applicable,
    required: opts.required ?? ["snapshot"],
    emptyApplicable: opts.emptyApplicable ?? "omit",
    overflow: "promote"
  };
}
var PROJECTIONS = {
  // Experience → Projects → Skills → Education → Achievements → Profile.
  resume: selective({
    furniture: RESUME_FURNITURE,
    applicable: ["timeline", "actions", "signals", "decisions", "risks", "snapshot"],
    required: ["snapshot"],
    emptyApplicable: "omit"
  }),
  // Vendor → Line items → Payment → Timeline → Totals (+ Invoice).
  invoice: selective({
    furniture: INVOICE_FURNITURE,
    applicable: ["decisions", "signals", "actions", "timeline", "risks", "snapshot"],
    required: ["snapshot"],
    emptyApplicable: "omit"
  }),
  // Research Question → Key Findings → Evidence → Insights → Limitations → Future Directions.
  research: selective({
    furniture: RESEARCH_FURNITURE,
    applicable: ["snapshot", "timeline", "signals", "decisions", "risks", "actions"],
    required: ["snapshot"],
    emptyApplicable: "omit"
  })
};
var GENERIC_KNOWLEDGE_PROJECTION = classicKeep(GENERIC_KNOWLEDGE_FURNITURE);
function memoryProjectionFor(archetype) {
  if (archetype === "resume" || archetype === "invoice" || archetype === "research") {
    return PROJECTIONS[archetype];
  }
  return GENERIC_KNOWLEDGE_PROJECTION;
}
function bucketLabel(archetype, kind) {
  return memoryProjectionFor(archetype).furniture[kind].label;
}
function isKindApplicable(archetype, kind) {
  return memoryProjectionFor(archetype).applicable.includes(kind);
}
function isEmptyMemoryPayload(payload) {
  if ("entries" in payload) {
    const notes2 = payload.notes ?? [];
    return payload.entries.length === 0 && notes2.length === 0;
  }
  const notes = payload.notes ?? [];
  const substantive = Boolean(payload.hook) || Boolean(payload.goal) || Boolean(payload.problem) || Boolean(payload.outcome) || notes.some((n) => n !== NOT_APPLICABLE_NOTE);
  return !substantive && !payload.summary.trim() && !payload.heading.trim();
}
function markNotApplicable(block) {
  const payload = block.payload;
  const existing = "notes" in payload ? payload.notes ?? [] : [];
  if (existing.includes(NOT_APPLICABLE_NOTE)) return block;
  return {
    ...block,
    payload: { ...payload, notes: [...existing, NOT_APPLICABLE_NOTE] }
  };
}
function projectAdaptiveMemories(blocks, archetype) {
  const spec = memoryProjectionFor(archetype);
  const byKind = /* @__PURE__ */ new Map();
  for (const block of blocks) byKind.set(block.kind, block);
  const out = [];
  const consumed = /* @__PURE__ */ new Set();
  for (const kind of spec.applicable) {
    const block = byKind.get(kind);
    if (!block) continue;
    consumed.add(kind);
    const titled = { ...block, title: spec.furniture[kind].label };
    const empty = isEmptyMemoryPayload(titled.payload);
    const required = spec.required.includes(kind);
    if (empty && !required) {
      if (spec.emptyApplicable === "omit") continue;
      if (spec.emptyApplicable === "not_applicable") {
        out.push(markNotApplicable(titled));
        continue;
      }
    }
    if (empty && required && spec.emptyApplicable === "not_applicable") {
      out.push(markNotApplicable(titled));
      continue;
    }
    out.push(titled);
  }
  if (spec.overflow === "promote") {
    for (const kind of ALL_KINDS) {
      if (consumed.has(kind)) continue;
      const block = byKind.get(kind);
      if (!block || isEmptyMemoryPayload(block.payload)) continue;
      out.push({ ...block, title: spec.furniture[kind].label });
    }
  }
  if (out.length === 0) {
    const snap = byKind.get("snapshot");
    if (snap) {
      out.push({ ...snap, title: spec.furniture.snapshot.label });
    }
  }
  return out;
}
var PAGE_MARK = /^<!--\s*page:(\d+)\s*-->$/i;
var IMAGE_MARK = /^<!--\s*image:page=(\d+)/i;
var ATX = /^(#{1,6})\s+(.+?)\s*$/;
var TABLE_ROW = /^\|(.+)\|$/;
var LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
function hybridSegment(source) {
  const rawLines = source.split("\n");
  const segments = [];
  let page = null;
  let current = null;
  let seq = 0;
  const start = (kind, title, lineNo, text, headingLevel = null) => {
    const segment = {
      id: `seg-${++seq}`,
      kind,
      title,
      headingLevel,
      page,
      lines: text.trim() === "" ? [] : [{ text, lineNo }],
      text: ""
    };
    segments.push(segment);
    return segment;
  };
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const lineNo = i + 1;
    const trimmed = line.trim();
    const pageMatch = PAGE_MARK.exec(trimmed);
    if (pageMatch) {
      page = Number(pageMatch[1]);
      continue;
    }
    if (IMAGE_MARK.test(trimmed)) {
      current = start("image", current?.title ?? "Embedded visual", lineNo, line);
      continue;
    }
    const heading = ATX.exec(trimmed);
    if (heading) {
      const level = Math.min(6, heading[1].length);
      current = start("section", heading[2].trim(), lineNo, "", level);
      continue;
    }
    if (TABLE_ROW.test(trimmed)) {
      if (!current || current.kind !== "table") {
        current = start("table", current?.title ?? null, lineNo, line);
      } else {
        current.lines.push({ text: line, lineNo });
      }
      continue;
    }
    if (LIST_ITEM.test(line)) {
      if (!current) current = start("list", null, lineNo, line);
      else if (current.kind === "prose" && current.lines.length === 0) {
        current.kind = "list";
        current.lines.push({ text: line, lineNo });
      } else {
        current.lines.push({ text: line, lineNo });
      }
      continue;
    }
    if (trimmed === "") {
      if (current?.kind === "prose") current = null;
      continue;
    }
    if (!current) {
      current = start("prose", null, lineNo, line);
      continue;
    }
    if (current.kind === "table") {
      current = start("prose", current.title, lineNo, line);
      continue;
    }
    current.lines.push({ text: line, lineNo });
  }
  const expanded = splitByTopicShift(segments);
  for (const segment of expanded) {
    segment.text = segment.lines.map((l) => l.text).join("\n").trim();
  }
  return {
    segments: expanded.filter((s) => s.text.length > 0 || s.title),
    markdown: toMarkdown(expanded)
  };
}
function splitByTopicShift(segments) {
  const out = [];
  let seq = 0;
  for (const segment of segments) {
    if (segment.kind !== "prose" || segment.title || segment.lines.length < 8) {
      out.push({ ...segment, id: `seg-${++seq}` });
      continue;
    }
    const paragraphs = groupParagraphs(segment.lines);
    if (paragraphs.length <= 1) {
      out.push({ ...segment, id: `seg-${++seq}` });
      continue;
    }
    let bucket = paragraphs[0];
    for (let i = 1; i < paragraphs.length; i++) {
      const next = paragraphs[i];
      const cohesion = jaccard(stemsOf(bucket), stemsOf(next));
      const bucketWords = bucket.reduce((n, l) => n + l.text.split(/\s+/).length, 0);
      if (cohesion < 0.12 && bucketWords >= 80) {
        out.push(paragraphsToSegment(++seq, segment, bucket));
        bucket = next;
      } else {
        bucket = bucket.concat(next);
      }
    }
    if (bucket.length) out.push(paragraphsToSegment(++seq, segment, bucket));
  }
  return out;
}
function groupParagraphs(lines) {
  return lines.map((l) => [l]);
}
function paragraphsToSegment(seq, parent, lines) {
  return {
    id: `seg-${seq}`,
    kind: "prose",
    title: parent.title,
    headingLevel: null,
    page: parent.page,
    lines,
    text: lines.map((l) => l.text).join("\n").trim()
  };
}
function stemsOf(lines) {
  const set = /* @__PURE__ */ new Set();
  for (const line of lines) {
    for (const token of contentTokens(line.text)) set.add(token);
  }
  return set;
}
function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
function toMarkdown(segments) {
  const parts = [];
  for (const segment of segments) {
    if (segment.page != null) parts.push(`<!-- page:${segment.page} -->`);
    if (segment.title && (segment.kind === "section" || segment.kind === "image")) {
      const level = segment.headingLevel ?? 2;
      parts.push(`${"#".repeat(level)} ${segment.title}`);
    }
    if (segment.lines.length) {
      parts.push(segment.lines.map((l) => l.text).join("\n"));
    }
    parts.push("");
  }
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
function buildDocumentGraph(segments) {
  const nodes = [];
  const edges = [];
  for (const segment of segments) {
    const type = classifyNode(segment);
    const node = {
      id: `node-${segment.id}`,
      type,
      title: segment.title,
      page: segment.page,
      segmentId: segment.id,
      excerpt: segment.text.slice(0, 180)
    };
    nodes.push(node);
  }
  for (let i = 1; i < nodes.length; i++) {
    const prev = nodes[i - 1];
    const cur = nodes[i];
    if (prev.page != null && prev.page === cur.page) {
      edges.push({ from: prev.id, to: cur.id, rel: "follows" });
    }
    if (prev.type === "section" && cur.type !== "section") {
      edges.push({ from: prev.id, to: cur.id, rel: "contains" });
    }
  }
  return { nodes, edges };
}
function classifyNode(segment) {
  const title = (segment.title ?? "").toLowerCase();
  if (segment.kind === "table") return "table";
  if (segment.kind === "image") return "image";
  if (segment.kind === "list" && /requirement|criteria|must\b/i.test(title + segment.text)) {
    return "requirement";
  }
  if (/open question|unresolved|tbd/i.test(title)) return "question";
  if (/risk|problem|pain|limitation|threat/i.test(title)) return "risk";
  if (/metric|kpi|success|signal|measure/i.test(title)) return "metric";
  if (/decision|requirement|priority|policy|rule/i.test(title)) return "decision";
  if (segment.kind === "section") return "section";
  if (segment.kind === "list") return "list";
  return "prose";
}
function understand(input) {
  const headings = input.sections.map((s) => s.headingText).filter((h) => h !== null);
  const sectionLines = input.sections.map((s) => s.lines.map((l) => plainContentOf(l.text)));
  const flatLines = sectionLines.flat().filter((l) => l.trim() !== "");
  const bodySample = flatLines.slice(0, 80).join("\n");
  const intent = understandIntent({ title: input.title, headings, lines: flatLines });
  const concepts = extractConcepts({ headings, sections: sectionLines });
  const archetype = classifyArchetype({ title: input.title, headings, bodySample });
  const anchor = findAnchorDate(`${input.title}
${bodySample}`, input.sourceLabel);
  const { statements, redundant } = distill(input.sections);
  const signals = dedupeByMeaning(inferSignals(statements, concepts), (s) => s.value.label);
  const decisions = dedupeByMeaning(
    inferDecisions(statements, intent, archetype.archetype),
    (d) => d.value.text
  );
  const risks = dedupeByMeaning(inferRisks(statements), (r) => r.value.risk);
  const timeline = archetype.timelineMode === "none" ? [] : dedupeByMeaning(inferTimeline(statements), (t) => `${t.value.date} ${t.value.title}`);
  const titleFromHeading = input.titleFromHeading ?? (input.sourceLabel == null || input.title !== input.sourceLabel.replace(/\.(md|markdown|txt)$/i, ""));
  const actions = dedupeByMeaning(
    inferActions(statements, titleFromHeading ? kindClaimedByHeading(input.title) : null),
    (a) => a.value.task
  );
  const heroInsights = deriveHeroInsights({
    archetype: archetype.archetype,
    statements,
    concepts,
    existingSignals: signals.map((s) => s.value)
  });
  return {
    intent,
    concepts,
    archetype,
    anchor,
    statements,
    signals,
    decisions,
    risks,
    timeline,
    actions,
    heroInsights,
    heading: recallHeading(input.title, intent),
    opening: firstProseParagraph(input.sections),
    distilled: statements.length,
    redundant
  };
}
function recallFrom(understanding, memories) {
  return composeRecall({
    intent: understanding.intent,
    concepts: understanding.concepts,
    ...memories,
    fallback: understanding.opening
  });
}
var MIN_STATEMENT_WORDS = 3;
var MAX_STATEMENT_WORDS = 60;
function distill(sections) {
  const raw = [];
  for (const section of sections) {
    for (const line of section.lines) {
      const text = line.text;
      if (text.trim() === "") continue;
      if (isDecorativeLine(text) || isTableSeparator(text)) continue;
      const item = splitListItem(text);
      const listItem = item !== null;
      const task = item?.marker === "task" ? item.done ? "done" : "open" : void 0;
      const content = plainContentOf(text);
      if (content.trim() === "") continue;
      const taskWords = wordCount(content);
      const sentences = task && taskWords >= MIN_STATEMENT_WORDS && taskWords <= MAX_STATEMENT_WORDS ? [content] : splitSentences(content);
      for (const sentence of sentences) {
        const words = wordCount(sentence);
        if (words < MIN_STATEMENT_WORDS || words > MAX_STATEMENT_WORDS) continue;
        raw.push({
          text: sentence,
          sectionTitle: section.headingText,
          lineNo: line.lineNo,
          listItem,
          ...task ? { task } : {}
        });
      }
    }
  }
  const statements = dedupeExact(raw, (s) => s.text);
  return { statements, redundant: raw.length - statements.length };
}
function dedupeExact(items, textOf) {
  const seen = /* @__PURE__ */ new Set();
  const kept = [];
  for (const item of items) {
    const key = normalizeKey(textOf(item));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(item);
  }
  return kept;
}
function firstProseParagraph(sections) {
  for (const section of sections) {
    const prose = [];
    for (const line of section.lines) {
      const text = line.text;
      if (text.trim() === "") {
        if (prose.length > 0) break;
        continue;
      }
      if (splitListItem(text) || isTableSeparator(text) || isDecorativeLine(text)) {
        if (prose.length > 0) break;
        continue;
      }
      prose.push(plainContentOf(text));
    }
    const joined = prose.join(" ").trim();
    if (wordCount(joined) >= 3) return joined;
  }
  return "";
}
function capExcerpt(text) {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > LIMITS.maxExcerptLength ? single.slice(0, LIMITS.maxExcerptLength - 1) + "\u2026" : single;
}
function parseText(input) {
  const { label } = input;
  const segmented = hybridSegment(input.text);
  const graph = buildDocumentGraph(segmented.segments);
  const text = segmented.markdown || input.text;
  const rawLines = text.split("\n");
  let title = label.replace(/\.(md|markdown|txt)$/i, "");
  let titleConsumedLine = -1;
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (line.trim() === "") continue;
    const heading = matchHeading(line, rawLines[i + 1]);
    if (heading && heading.level === 1) {
      title = heading.text;
      titleConsumedLine = i;
    }
    break;
  }
  const sections = [];
  const ordinals = [];
  const ordinalSections = /* @__PURE__ */ new Map();
  let current = null;
  let pendingOrdinal = null;
  const startSection = (kind, headingText, headingLine, inherited = false) => {
    const section = {
      kind,
      assigned: kind !== null,
      headingText,
      headingLine,
      inherited,
      lines: []
    };
    sections.push(section);
    return section;
  };
  const claimedStack = [];
  for (let i = 0; i < rawLines.length; i++) {
    if (i === titleConsumedLine) continue;
    const line = rawLines[i];
    if (isStructuralLine(line)) continue;
    const heading = matchHeading(line, rawLines[i + 1]);
    if (heading) {
      const ordinal = matchOrdinalHeading(heading.text);
      if (ordinal) {
        pendingOrdinal = { marker: ordinal.marker, title: ordinal.rest || null, line: i + 1 };
        ordinals.push(pendingOrdinal);
        current = startSection(null, heading.text, i + 1);
        ordinalSections.set(pendingOrdinal, current);
        continue;
      }
      if (pendingOrdinal && !pendingOrdinal.title) pendingOrdinal.title = heading.text;
      let kind = classifyHeading(heading.text);
      let inherited = false;
      if (kind !== null) {
        while (claimedStack.length > 0 && claimedStack[claimedStack.length - 1].level >= heading.level) {
          claimedStack.pop();
        }
        claimedStack.push({ level: heading.level, kind });
      } else {
        const parent = [...claimedStack].reverse().find((c) => c.level < heading.level);
        if (parent) {
          kind = parent.kind;
          inherited = true;
        }
      }
      current = startSection(kind, heading.text, i + 1, inherited);
      if (/^as an?\s+/i.test(heading.text)) {
        current.lines.push({ text: `- Persona: ${heading.text}`, lineNo: i + 1 });
      }
      continue;
    }
    if (line.trim() !== "" && pendingOrdinal && !pendingOrdinal.title) {
      pendingOrdinal.title = plainContentOf(line).slice(0, 120) || null;
    }
    const sourceLine = { text: line, lineNo: i + 1 };
    if (!current) current = startSection("snapshot", null, null);
    current.lines.push(sourceLine);
  }
  const CHANGELOG_SECTIONS = {
    added: "actions",
    changed: "actions",
    fixed: "actions",
    removed: "actions",
    deprecated: "actions",
    security: "actions",
    "breaking changes": "actions",
    "bug fixes": "actions"
  };
  const looksLikeChangelog = /change\s?log|release notes|what'?s new/i.test(title) || sections.some((sec) => sec.headingText && /^v?\d+\.\d+(\.\d+)?\b/.test(sec.headingText.trim()));
  if (looksLikeChangelog) {
    for (const section of sections) {
      if (section.kind !== null || !section.headingText) continue;
      const kind = CHANGELOG_SECTIONS[section.headingText.trim().toLowerCase()];
      if (kind) {
        section.kind = kind;
        section.assigned = true;
      }
    }
  }
  const SCHEDULE_ORDINAL = /^(phase|task|step|stage|milestone|sprint|iteration|week|day|quarter|month)\b/i;
  for (const section of sections) {
    if (section.kind !== null) continue;
    const ordinal = section.headingText ? matchOrdinalHeading(section.headingText) : null;
    if (ordinal && SCHEDULE_ORDINAL.test(ordinal.marker)) continue;
    const inferred = inferKindFromLines(section.lines.map((l) => l.text));
    if (inferred) {
      section.kind = inferred;
      section.assigned = true;
    }
  }
  assignKindsFromGraph(sections, graph);
  const warnings = [];
  let leftovers = sections.filter((s) => s.kind === null);
  const understanding = understand({
    title,
    titleFromHeading: titleConsumedLine >= 0,
    sourceLabel: label,
    sections: sections.map((s) => ({ headingText: s.headingText, lines: s.lines }))
  });
  const consumedOrdinalSections = /* @__PURE__ */ new Set();
  const timelineExtras = understanding.archetype.timelineMode === "none" ? [] : ordinals.filter((o) => o.title).slice(0, LIMITS.maxEntriesPerBlock).map((o) => {
    const section = ordinalSections.get(o);
    const ownable = section && SCHEDULE_ORDINAL.test(o.marker);
    const details = ownable ? section.lines.map((l) => plainContentOf(l.text).trim()).filter((t) => t.length > 0 && t !== o.title) : [];
    if (details.length > LIMITS.maxEntriesPerBlock) {
      return { date: o.marker, title: o.title, state: "planned" };
    }
    if (section && ownable && section.kind === null) consumedOrdinalSections.add(section);
    return {
      date: o.marker,
      title: o.title,
      state: "planned",
      ...details.length > 0 ? { details } : {}
    };
  });
  leftovers = leftovers.filter((s) => !consumedOrdinalSections.has(s));
  const ctx = {
    title,
    label,
    warnings,
    understanding,
    recall: null,
    leftovers,
    extraTimeline: timelineExtras,
    keptOnPurpose: 0
  };
  const built = /* @__PURE__ */ new Map();
  const isResearch = understanding.archetype.archetype === "research";
  let researchGraph;
  if (isResearch) {
    const researchSections = sections.map((s) => ({
      headingText: s.headingText,
      lines: s.lines
    }));
    const researchBuilt = buildResearchWorldModel({
      title,
      label,
      sections: researchSections
    });
    for (const kind of BLOCK_KINDS) {
      const block = researchBuilt.get(kind);
      if (block) built.set(kind, block);
    }
    const localGraph = buildResearchKnowledgeGraph({
      title,
      label,
      sections: researchSections
    });
    researchGraph = mergeKnowledgeGraphs(input.knowledgeGraph, localGraph);
    warnings.push({
      code: "text.understood",
      message: `Knowledge graph: ${researchGraph.nodes.length} nodes / ${researchGraph.edges.length} edges via ${researchGraph.extractor}${input.parsedByDocling ? " \xB7 Docling parse" : ""}.`
    });
    warnings.push({
      code: "text.adaptive-projection",
      message: "Research path: section summaries \u2192 cross-section reasoning \u2192 world model (not chunk\u2192bucket)."
    });
  } else {
    for (const kind of BLOCK_KINDS) {
      if (kind === "snapshot") continue;
      built.set(kind, buildBlock(kind, sections.filter((s) => s.kind === kind), ctx));
    }
    harvestArchetypeTimeline(built, sections, understanding, warnings);
    applyTemporalHonesty(built, understanding, warnings);
    ctx.recall = recallFrom(understanding, {
      signals: entriesOf2(built, "signals"),
      decisions: entriesOf2(built, "decisions"),
      risks: entriesOf2(built, "risks"),
      timeline: entriesOf2(built, "timeline"),
      actions: entriesOf2(built, "actions")
    });
    built.set("snapshot", buildBlock("snapshot", sections.filter((s) => s.kind === "snapshot"), ctx));
  }
  const blocks = projectAdaptiveMemories(
    BLOCK_KINDS.map((kind) => built.get(kind)),
    understanding.archetype.archetype
  );
  if (!isResearch) linkActionsToDecisions2(blocks);
  warnings.push(...understandingWarnings(understanding));
  warnings.push(...graphWarnings(graph, segmented.segments.length));
  const { archetype: detected, label: archetypeLabel, score, scores, reasons } = understanding.archetype;
  const reasonLine = reasons.length > 0 ? ` \xB7 Reason: ${reasons.map((r) => `\u2713 ${r}`).join(" ")}` : "";
  warnings.push({
    code: "text.adaptive-projection",
    message: `Detected Archetype: ${archetypeLabel} \xB7 Raw Scores: Resume ${scores.resume}, Research ${scores.research}, Invoice ${scores.invoice} \xB7 Projection: ${archetypeLabel}${reasonLine}`
  });
  const document = finalizeDocument({
    title,
    sourceMethod: "local-parser",
    sourceLabel: label,
    blocks,
    warnings,
    archetype: {
      id: detected,
      label: archetypeLabel,
      ...score !== void 0 ? { score } : {},
      scores,
      ...reasons.length > 0 ? { reasons: [...reasons] } : {}
    },
    ...researchGraph ? { knowledgeGraph: researchGraph } : {}
  });
  return ok(
    document,
    warnings.map((w) => ({ code: w.code, message: w.message }))
  );
}
function graphWarnings(graph, segmentCount) {
  if (segmentCount === 0) return [];
  const types = new Set(graph.nodes.map((n) => n.type));
  const parts = [
    `Segmented into ${segmentCount} semantic chunks`,
    `graph ${graph.nodes.length} nodes / ${graph.edges.length} links`
  ];
  if (types.has("table")) parts.push("tables preserved");
  if (types.has("image")) parts.push("embedded visuals linked");
  if (types.has("requirement") || types.has("decision")) parts.push("requirements grounded");
  return [{ code: "text.understood", message: `${parts.join("; ")}.` }];
}
function graphTypeToKind(type) {
  switch (type) {
    case "requirement":
    case "decision":
      return "decisions";
    case "risk":
      return "risks";
    case "metric":
    case "question":
      return "signals";
    default:
      return null;
  }
}
function assignKindsFromGraph(sections, graph) {
  if (graph.nodes.length === 0) return;
  for (const section of sections) {
    if (section.kind !== null) continue;
    const title = section.headingText?.trim().toLowerCase() ?? "";
    if (!title) continue;
    const node = graph.nodes.find((n) => {
      const nt = n.title?.trim().toLowerCase() ?? "";
      if (!nt) return false;
      return nt === title || title.includes(nt) || nt.includes(title);
    });
    if (!node) continue;
    const kind = graphTypeToKind(node.type);
    if (!kind) continue;
    section.kind = kind;
    section.assigned = true;
  }
}
function entriesOf2(built, kind) {
  const block = built.get(kind);
  if (!block || !("entries" in block.payload)) return [];
  return block.payload.entries;
}
function harvestArchetypeTimeline(built, sections, understanding, warnings) {
  const mode = understanding.archetype.timelineMode;
  if (mode === "none") return;
  const timelineBlock = built.get("timeline");
  if (!timelineBlock || !("entries" in timelineBlock.payload)) return;
  const entries = timelineBlock.payload.entries;
  const before = entries.length;
  const pushUnique = (entry) => {
    if (entries.length >= LIMITS.maxEntriesPerBlock) return;
    if (entries.some((e) => e.date === entry.date && saysTheSame(e.title, entry.title))) return;
    entries.push(entry);
  };
  for (const section of sections) {
    for (const line of section.lines) {
      const text = plainContentOf(line.text);
      if (!text) continue;
      if (mode === "single_leg") {
        const leg = harvestSingleLegLine(text);
        if (leg) pushUnique(leg);
        continue;
      }
      if (mode === "obligation_deadlines") {
        if (!shouldProjectInvoiceDueToTimeline(text)) continue;
        const due = parseObligationDateLine(text);
        if (due) pushUnique(due);
      }
    }
  }
  if (mode === "obligation_deadlines") {
    const signalsBlock = built.get("signals");
    if (signalsBlock && "entries" in signalsBlock.payload) {
      const signals = signalsBlock.payload.entries;
      const kept = [];
      for (const signal of signals) {
        const asLine = `${signal.label}: ${signal.value ?? ""}`.trim();
        if ((shouldProjectInvoiceDueToTimeline(asLine) || /^due(?:\s+date)?$/i.test(signal.label) && signal.value != null && shouldProjectInvoiceDueToTimeline(`Due date: ${signal.value}`)) && (isInvoiceArchetype(understanding.archetype.archetype) || mode === "obligation_deadlines")) {
          const due = parseObligationDateLine(asLine) ?? (signal.value != null ? {
            date: String(signal.value),
            title: `Due date: ${signal.value}`,
            state: "planned"
          } : null);
          if (due) {
            pushUnique(due);
            continue;
          }
        }
        kept.push(signal);
      }
      signalsBlock.payload.entries = kept;
    }
  }
  if (mode === "single_leg") {
    timelineBlock.payload.entries = projectSingleLegTimeline(entries);
  }
  const after = timelineBlock.payload.entries.length;
  const added = Math.max(0, after - before);
  if (added > 0) {
    warnings.push({
      code: "text.timeline-harvested",
      message: `Projected ${added} ${understanding.archetype.label.toLowerCase()} date memor${added === 1 ? "y" : "ies"} into Timeline.`
    });
  }
}
function applyTemporalHonesty(built, understanding, warnings) {
  const timelineBlock = built.get("timeline");
  if (!timelineBlock || !("entries" in timelineBlock.payload)) return;
  const before = timelineBlock.payload.entries;
  const gated = gateTimelineEntries(before, understanding.archetype, understanding.anchor);
  timelineBlock.payload.entries = gated.timeline;
  if (gated.demoted.length === 0) return;
  const signalsBlock = built.get("signals");
  if (signalsBlock && "entries" in signalsBlock.payload) {
    const entries = signalsBlock.payload.entries;
    for (const text of gated.demoted) {
      if (entries.length >= LIMITS.maxEntriesPerBlock) break;
      entries.push({
        label: "Unresolved temporal",
        implication: text.slice(0, LIMITS.maxFieldLength)
      });
    }
  }
  warnings.push({
    code: "text.timeline-gated",
    message: `Kept Timeline honest for ${understanding.archetype.label} (${understanding.archetype.timelineMode}): moved ${gated.demoted.length} weak temporal item${gated.demoted.length === 1 ? "" : "s"} to Signals.`
  });
}
function linkActionsToDecisions2(blocks) {
  const decisions = blocks.find((b) => b.kind === "decisions");
  const actions = blocks.find((b) => b.kind === "actions");
  if (!decisions || !actions) return;
  if (!("entries" in decisions.payload) || !("entries" in actions.payload)) return;
  const decisionEntries = decisions.payload.entries;
  if (decisionEntries.length === 0) return;
  for (const action of actions.payload.entries) {
    if (action.from) continue;
    const match = decisionEntries.find((decision) => saysTheSame(decision.text, action.task));
    if (match) action.from = match.ref ?? match.text;
  }
}
function understandingWarnings(understanding) {
  const inferred = understanding.signals.length + understanding.decisions.length + understanding.risks.length + understanding.timeline.length + understanding.actions.length;
  const parts = [];
  parts.push(
    `Read ${understanding.distilled} distinct statements as a ${understanding.intent.kind} (${understanding.archetype.label}, timeline ${understanding.archetype.timelineMode})`
  );
  if (understanding.anchor.confidence !== "none" && understanding.anchor.value) {
    parts.push(`anchor ${understanding.anchor.value}`);
  } else {
    parts.push("no date anchor");
  }
  if (understanding.redundant > 0) parts.push(`set aside ${understanding.redundant} restatements`);
  if (inferred > 0) {
    parts.push(
      `inferred ${inferred} memories from meaning (S${understanding.signals.length}/D${understanding.decisions.length}/R${understanding.risks.length}/T${understanding.timeline.length}/A${understanding.actions.length})`
    );
  }
  if (understanding.heroInsights.length > 0) {
    parts.push(
      `selected ${understanding.heroInsights.length} hero insight${understanding.heroInsights.length === 1 ? "" : "s"}`
    );
  }
  if (inferred === 0 && understanding.redundant === 0 && understanding.distilled === 0) return [];
  return [{ code: "text.understood", message: `${parts.join(", ")}.` }];
}
function buildBlock(kind, matched, ctx) {
  const { label, warnings } = ctx;
  const contentLines = matched.flatMap((s) => s.lines).filter((l) => l.text.trim() !== "");
  const assigned = matched.some((s) => s.assigned);
  const notes = [];
  let payload;
  if (kind === "snapshot") {
    payload = buildSnapshotPayload(contentLines, notes, ctx);
  } else {
    payload = buildEntriesPayload(kind, contentLines, notes, assigned, ctx, matched);
  }
  const entryCount = payload.entries?.length ?? 0;
  const hasNotes = notes.length > (kind === "snapshot" ? ctx.keptOnPurpose : 0);
  const archetypeId = ctx.understanding.archetype.archetype;
  const applicable = isKindApplicable(archetypeId, kind);
  const projectedLabel = bucketLabel(archetypeId, kind);
  const keepsEmptyBuckets = applicable && memoryProjectionFor(archetypeId).emptyApplicable === "keep";
  if (entryCount === 0 && notes.length === 0 && kind !== "snapshot") {
    if (keepsEmptyBuckets) {
      warnings.push({
        code: "text.no-blocks-recognized",
        message: `No ${projectedLabel.toLowerCase()} were recognized, so that memory is empty. Nothing was invented.`
      });
    }
  } else if (hasNotes) {
    warnings.push({
      code: "text.unrecognized-section",
      message: `Some text wasn't clearly recognized and is kept as-is in the ${projectedLabel} memory.`
    });
  }
  const method = kind !== "snapshot" && entryCount === 0 && notes.length > 0 ? "recovered" : "local-parser";
  const primary = matched.find((s) => s.assigned) ?? matched[0] ?? null;
  return {
    kind,
    payload,
    provenance: {
      method,
      label,
      locator: locatorOf(primary, contentLines, entryCount > 0 || kind === "snapshot"),
      excerpt: capExcerpt(contentLines.slice(0, 3).map((l) => l.text).join(" "))
    }
  };
}
function locatorOf(section, contentLines, found) {
  if (!section || contentLines.length === 0 && section.headingLine === null) {
    return found ? "source" : "not found in source";
  }
  const firstLine = section.headingLine ?? contentLines[0]?.lineNo ?? 1;
  const lastLine = contentLines[contentLines.length - 1]?.lineNo ?? firstLine;
  const range = firstLine === lastLine ? `line ${firstLine}` : `lines ${firstLine}\u2013${lastLine}`;
  return section.headingText ? `heading \u201C${section.headingText}\u201D \xB7 ${range}` : range;
}
function buildEntriesPayload(kind, contentLines, notes, assigned, ctx, matched = []) {
  const collectOver = (lines, strict, lenient, options = {}) => {
    let tableHeaderCells = null;
    const entries = [];
    const lineOf = [];
    const used = new Set(options.skip ?? []);
    const unmatched = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (used.has(line.lineNo)) continue;
      if (isDecorativeLine(line.text)) continue;
      if (isTableSeparator(line.text)) continue;
      const next = lines[i + 1];
      if (splitTableRow(line.text) && next && isTableSeparator(next.text)) {
        tableHeaderCells = splitTableRow(line.text).map((c) => c.trim().toLowerCase());
        continue;
      }
      const rowCells = splitTableRow(line.text);
      const strictEntry = strict(line.text);
      const entry = strictEntry && rowCells && tableHeaderCells && options.remapRow ? options.remapRow(strictEntry, rowCells, tableHeaderCells) : strictEntry;
      if (entry) {
        entries.push(entry);
        lineOf.push(line.lineNo);
        used.add(line.lineNo);
      } else {
        unmatched.push(line);
      }
    }
    const strictCount = entries.length;
    const useLenient = assigned && (strictCount === 0 || options.salvageLists === true);
    for (const line of unmatched) {
      const tryLenient = useLenient && entries.length < LIMITS.maxEntriesPerBlock && (isListLike(line.text) || options.salvageProse === true && plainContentOf(line.text).length >= 24);
      if (tryLenient) {
        const entry = strictCount === 0 ? lenient(line.text) : options.salvage?.(line.text) ?? null;
        if (entry) {
          entries.push(entry);
          lineOf.push(line.lineNo);
          used.add(line.lineNo);
          continue;
        }
      }
      if (notes.length < LIMITS.maxNotesPerBlock) notes.push(stripListMarker(line.text));
    }
    return { entries, lineOf, used, ...notes.length > 0 ? { notes } : {} };
  };
  const collect = (strict, lenient, options = {}) => collectOver(contentLines, strict, lenient, options);
  const finish = (built) => ({ entries: built.entries, ...built.notes ? { notes: built.notes } : {} });
  switch (kind) {
    case "signals": {
      const built = collect(parseSignalLine, parseSignalLineLenient, {
        salvageLists: true,
        salvage: parseSignalSalvage
      });
      mergeSignals(built, ctx, notes);
      built.entries = dedupeByMeaning(built.entries, (e) => `${e.label} ${e.implication ?? ""}`);
      return finish(built);
    }
    case "decisions": {
      const built = collect(parseDecisionLine, parseDecisionLineLenient, {
        salvageLists: true,
        salvageProse: true,
        salvage: parseDecisionLineLenient
      });
      mergeDecisions(built, ctx, notes);
      built.entries = compressDecisions(built.entries);
      return finish(built);
    }
    case "timeline": {
      const lines = groupingLines(matched, contentLines);
      const groups = detectEntityGroups(lines);
      const grouped = groups.map((g) => ({ entry: buildTimelineFromGroup(g), lineNo: g.titleLine.lineNo, group: g })).filter(
        (g) => g.entry !== null
      );
      const skip = new Set(grouped.flatMap((g) => groupLineNumbers(g.group)));
      const built = collectOver(lines, parseTimelineLine, parseTimelineLineLenient, { skip });
      for (const g of grouped) {
        built.entries.push(g.entry);
        built.lineOf.push(g.lineNo);
      }
      sortByLine(built);
      mergeTimeline(built, ctx, notes);
      if (ctx.extraTimeline.length > 0) {
        const room = LIMITS.maxEntriesPerBlock - built.entries.length;
        for (const extra of ctx.extraTimeline.slice(0, Math.max(0, room))) {
          if (built.entries.some((e) => e.date === extra.date && saysTheSame(e.title, extra.title))) {
            continue;
          }
          built.entries.push(extra);
        }
      }
      built.entries = dedupeByMeaning(built.entries, (e) => `${e.date} ${e.title}`);
      return finish(built);
    }
    case "risks": {
      const built = collect(parseRiskLine, parseRiskLineLenient);
      mergeRisks(built, ctx, notes);
      built.entries = dedupeByMeaning(built.entries, (e) => e.risk);
      return finish(built);
    }
    case "actions": {
      const lines = groupingLines(matched, contentLines);
      const groups = detectEntityGroups(lines);
      const grouped = groups.map((g) => ({
        entry: buildActionFromGroup(g),
        lineNo: g.titleLine.lineNo,
        group: g
      }));
      const skip = new Set(grouped.flatMap((g) => groupLineNumbers(g.group)));
      const built = collectOver(lines, parseActionLine, parseActionLineLenient, {
        skip,
        remapRow: remapActionEntryByHeader
      });
      for (const g of grouped) {
        built.entries.push(g.entry);
        built.lineOf.push(g.lineNo);
      }
      sortByLine(built);
      const DONE_CHANGELOG_HEADINGS = /* @__PURE__ */ new Set([
        "added",
        "changed",
        "fixed",
        "removed",
        "deprecated",
        "security",
        "breaking changes",
        "bug fixes"
      ]);
      for (const section of matched) {
        const h = section.headingText?.trim().toLowerCase() ?? "";
        if (!DONE_CHANGELOG_HEADINGS.has(h)) continue;
        const sectionLines = new Set(section.lines.map((l) => l.lineNo));
        built.entries.forEach((e, idx) => {
          if (e.status === "pending" && sectionLines.has(built.lineOf[idx])) e.status = "done";
        });
      }
      {
        const doneLines = /* @__PURE__ */ new Set();
        for (const section of matched) {
          const secLines = section.lines;
          for (let li = 0; li < secLines.length; li++) {
            if (!isCompletionLabelLine(secLines[li].text)) continue;
            let lj = li + 1;
            while (lj < secLines.length && isListLike(secLines[lj].text)) {
              doneLines.add(secLines[lj].lineNo);
              lj++;
            }
          }
        }
        if (doneLines.size > 0) {
          built.entries.forEach((e, idx) => {
            if (doneLines.has(built.lineOf[idx])) e.status = "done";
          });
        }
        const readyLines = /* @__PURE__ */ new Set();
        for (const section of matched) {
          const secLines = section.lines;
          for (let li = 0; li < secLines.length; li++) {
            if (!isReadinessLabelLine(secLines[li].text)) continue;
            let lj = li + 1;
            while (lj < secLines.length && isListLike(secLines[lj].text)) {
              readyLines.add(secLines[lj].lineNo);
              lj++;
            }
          }
        }
        if (readyLines.size > 0) {
          built.entries.forEach((e, idx) => {
            if (e.status === "pending" && readyLines.has(built.lineOf[idx])) e.status = "ready";
          });
        }
      }
      const READY_HEADINGS = /* @__PURE__ */ new Set(["ready", "ready to go", "ready to ship", "ready to start"]);
      for (const section of matched) {
        const h = section.headingText?.trim().toLowerCase() ?? "";
        if (!READY_HEADINGS.has(h)) continue;
        const sectionLines = new Set(section.lines.map((l) => l.lineNo));
        built.entries.forEach((e, idx) => {
          if (e.status === "pending" && sectionLines.has(built.lineOf[idx])) e.status = "ready";
        });
      }
      for (const section of matched) {
        const heading = section.headingText?.replace(/^\d+(\.\d+)*\.?\s*/, "").trim() ?? "";
        if (!/^as an?\s+/i.test(heading)) continue;
        const task = `Persona: ${heading}`.slice(0, LIMITS.maxFieldLength);
        if (built.entries.some((e) => saysTheSame(e.task, task))) continue;
        if (built.entries.length >= LIMITS.maxEntriesPerBlock) break;
        built.entries.unshift({ task, status: "pending" });
      }
      mergeActions(built, ctx, notes);
      built.entries = dedupeByMeaning(built.entries, (e) => e.task);
      return finish(built);
    }
  }
}
function groupingLines(matched, contentLines) {
  if (!matched.some((s) => s.inherited && s.headingText !== null && s.headingLine !== null)) {
    return contentLines;
  }
  const out = [];
  for (const section of matched) {
    if (section.inherited && section.headingText !== null && section.headingLine !== null) {
      out.push({ text: `**${section.headingText}**`, lineNo: section.headingLine });
    }
    for (const line of section.lines) {
      if (line.text.trim() !== "") out.push(line);
    }
  }
  return out;
}
function sortByLine(built) {
  const order = built.entries.map((_, i) => i);
  order.sort(
    (a, b) => (built.lineOf[a] ?? Number.MAX_SAFE_INTEGER) - (built.lineOf[b] ?? Number.MAX_SAFE_INTEGER)
  );
  built.entries = order.map((i) => built.entries[i]);
  built.lineOf = order.map((i) => built.lineOf[i] ?? null);
}
var INFERRED_BUDGET = 24;
function alreadyUsed(lineNo, built) {
  return built.used.has(lineNo) || built.lineOf.includes(lineNo);
}
function mergeHeroInsights(built, ctx, notes) {
  for (const insight of ctx.understanding.heroInsights) {
    if (built.entries.length >= LIMITS.maxEntriesPerBlock) break;
    if (alreadyUsed(insight.evidence.lineNo, built)) continue;
    if (built.entries.some((e) => saysTheSame(`${e.label} ${e.implication ?? ""}`, `${insight.entry.label} ${insight.entry.implication ?? ""}`))) continue;
    built.entries.unshift(insight.entry);
    built.lineOf.unshift(insight.evidence.lineNo);
    dropNote(notes, insight.evidence.text);
  }
}
function mergeSignals(built, ctx, notes) {
  mergeHeroInsights(built, ctx, notes);
  let added = 0;
  for (const candidate of ctx.understanding.signals) {
    const { value, evidence } = candidate;
    const existing = built.entries.findIndex((_, i) => built.lineOf[i] === evidence.lineNo);
    if (existing >= 0) {
      const entry = built.entries[existing];
      if (!entry.implication && value.implication) entry.implication = value.implication;
      if (!entry.trend && value.trend) entry.trend = value.trend;
      continue;
    }
    if (added >= INFERRED_BUDGET) continue;
    if (built.entries.length >= LIMITS.maxEntriesPerBlock) break;
    if (alreadyUsed(evidence.lineNo, built)) continue;
    if (built.entries.some((e) => saysTheSame(e.label, value.label))) continue;
    built.entries.push({
      label: value.label,
      ...value.trend ? { trend: value.trend } : {},
      ...value.implication ? { implication: value.implication } : {}
    });
    built.lineOf.push(evidence.lineNo);
    dropNote(notes, evidence.text);
    added++;
  }
}
function mergeDecisions(built, ctx, notes) {
  let added = 0;
  for (const candidate of ctx.understanding.decisions) {
    const { value, evidence } = candidate;
    const existing = built.entries.findIndex((_, i) => built.lineOf[i] === evidence.lineNo);
    if (existing >= 0) {
      const entry = built.entries[existing];
      if (!entry.because && value.because) entry.because = value.because;
      entry.commitment = value.commitment;
      continue;
    }
    if (value.commitment !== "committed") continue;
    if (blocksDecisionInference(evidence.text) || blocksDecisionInference(value.text)) continue;
    if (added >= INFERRED_BUDGET) continue;
    if (built.entries.length >= LIMITS.maxEntriesPerBlock) break;
    if (alreadyUsed(evidence.lineNo, built)) continue;
    if (isDecisionChrome(value.text)) continue;
    if (built.entries.some((e) => sameDecision(e.text, value.text))) continue;
    built.entries.push({
      text: value.text,
      status: "proposed",
      commitment: value.commitment,
      ...value.because ? { because: value.because } : {}
    });
    built.lineOf.push(evidence.lineNo);
    dropNote(notes, evidence.text);
    added++;
  }
}
function mergeRisks(built, ctx, notes) {
  let added = 0;
  for (const candidate of ctx.understanding.risks) {
    const { value, evidence } = candidate;
    const existing = built.entries.findIndex((_, i) => built.lineOf[i] === evidence.lineNo);
    if (existing >= 0) {
      const entry = built.entries[existing];
      if (!entry.because && value.because) entry.because = value.because;
      if (!entry.consequence && value.consequence) entry.consequence = value.consequence;
      continue;
    }
    if (added >= INFERRED_BUDGET) continue;
    if (built.entries.length >= LIMITS.maxEntriesPerBlock) break;
    if (alreadyUsed(evidence.lineNo, built)) continue;
    if (built.entries.some((e) => saysTheSame(e.risk, value.risk))) continue;
    built.entries.push({
      risk: value.risk,
      ...value.because ? { because: value.because } : {},
      ...value.consequence ? { consequence: value.consequence } : {}
    });
    built.lineOf.push(evidence.lineNo);
    dropNote(notes, evidence.text);
    added++;
  }
}
function mergeTimeline(built, ctx, notes) {
  if (ctx.understanding.archetype.timelineMode === "none") return;
  let added = 0;
  for (const candidate of ctx.understanding.timeline) {
    const { value, evidence } = candidate;
    const existing = built.entries.findIndex((_, i) => built.lineOf[i] === evidence.lineNo);
    if (existing >= 0) continue;
    if (added >= INFERRED_BUDGET) continue;
    if (built.entries.length >= LIMITS.maxEntriesPerBlock) break;
    if (alreadyUsed(evidence.lineNo, built)) continue;
    if (built.entries.some((e) => e.date === value.date && saysTheSame(e.title, value.title))) {
      continue;
    }
    built.entries.push({
      date: value.date,
      title: value.title,
      state: value.state ?? "planned",
      ...value.produces ? { produces: value.produces } : {},
      ...value.requires ? { requires: value.requires } : {}
    });
    built.lineOf.push(evidence.lineNo);
    dropNote(notes, evidence.text);
    added++;
  }
}
function mergeActions(built, ctx, notes) {
  let added = 0;
  for (const candidate of ctx.understanding.actions) {
    const { value, evidence } = candidate;
    const existing = built.entries.findIndex((_, i) => built.lineOf[i] === evidence.lineNo);
    if (existing >= 0) {
      const entry = built.entries[existing];
      if (!entry.owner && value.owner) entry.owner = value.owner;
      if (!entry.due && value.due) entry.due = value.due;
      if (!entry.from && value.from) entry.from = value.from;
      continue;
    }
    if (added >= INFERRED_BUDGET) continue;
    if (built.entries.length >= LIMITS.maxEntriesPerBlock) break;
    if (alreadyUsed(evidence.lineNo, built)) continue;
    if (built.entries.some((e) => saysTheSame(e.task, value.task))) continue;
    built.entries.push({
      task: value.task,
      status: value.status ?? "pending",
      ...value.owner ? { owner: value.owner } : {},
      ...value.due ? { due: value.due } : {},
      ...value.from ? { from: value.from } : {}
    });
    built.lineOf.push(evidence.lineNo);
    dropNote(notes, evidence.text);
    added++;
  }
}
function dropNote(notes, text) {
  const index = notes.findIndex((note) => saysTheSame(note, text));
  if (index >= 0) notes.splice(index, 1);
}
function compressDecisions(entries) {
  const kept = [];
  for (const entry of entries) {
    if (isDecisionChrome(entry.text)) continue;
    const existing = kept.findIndex((k) => sameDecision(k.text, entry.text));
    if (existing < 0) {
      kept.push({ ...entry });
      continue;
    }
    kept[existing] = mergeDecisionPair(kept[existing], entry);
  }
  return kept;
}
function mergeDecisionPair(a, b) {
  const statusRank = { rejected: 0, proposed: 1, requested: 2, approved: 3 };
  const commitmentRank = { considered: 0, committed: 1 };
  const status = statusRank[a.status] >= statusRank[b.status] ? a.status : b.status;
  const aCommit = a.commitment ?? "considered";
  const bCommit = b.commitment ?? "considered";
  const commitment = commitmentRank[aCommit] >= commitmentRank[bCommit] ? a.commitment : b.commitment;
  const text = a.text.length >= b.text.length ? a.text : b.text;
  return {
    ...a,
    text,
    status,
    ...commitment ? { commitment } : {},
    ...a.because || b.because ? { because: a.because ?? b.because } : {},
    ...a.ref || b.ref ? { ref: a.ref ?? b.ref } : {}
  };
}
var BYLINE2 = /^(prepared\s+by|by\s+\w|reviewed\s+by|author)/i;
var LEFTOVER_NOTE_BUDGET = 24;
function buildSnapshotPayload(contentLines, notes, ctx) {
  const { understanding, leftovers } = ctx;
  const recall = ctx.recall;
  const paragraphs = [];
  let byline;
  let buffer = [];
  const flush = () => {
    if (buffer.length > 0) {
      paragraphs.push(buffer.join(" ").trim());
      buffer = [];
    }
  };
  for (const line of contentLines) {
    const text = line.text.trim();
    if (isTableSeparator(text) || isDecorativeLine(text)) continue;
    if (BYLINE2.test(text) && byline === void 0 && paragraphs.length <= 1) {
      flush();
      byline = text;
      continue;
    }
    if (splitListItem(line.text) || splitTableRow(line.text)) {
      flush();
      if (notes.length < LIMITS.maxNotesPerBlock) notes.push(stripListMarker(text));
      continue;
    }
    buffer.push(stripEmphasis(text));
  }
  flush();
  const opening = paragraphs.shift() ?? "";
  const summary = recall?.summary || opening;
  if (recall?.composed && opening !== "" && notes.length < LIMITS.maxNotesPerBlock) {
    notes.push(opening);
    ctx.keptOnPurpose += 1;
  }
  for (const extra of paragraphs) {
    if (notes.length < LIMITS.maxNotesPerBlock) notes.push(extra);
  }
  let budget = LEFTOVER_NOTE_BUDGET;
  for (const section of leftovers) {
    if (budget <= 0 || notes.length >= LIMITS.maxNotesPerBlock) break;
    if (section.headingText) {
      notes.push(stripEmphasis(section.headingText));
      budget--;
    }
    for (const line of section.lines) {
      if (budget <= 0 || notes.length >= LIMITS.maxNotesPerBlock) break;
      const text = line.text.trim();
      if (text === "" || isDecorativeLine(text) || isTableSeparator(text)) continue;
      notes.push(plainContentOf(line.text));
      budget--;
    }
  }
  return {
    heading: understanding.heading,
    summary: summary || "Nothing here reads as a summary yet. The source text is kept below, exactly as it arrived.",
    ...recall?.hook ? { hook: recall.hook } : {},
    ...recall?.goal ? { goal: recall.goal } : {},
    ...recall?.problem ? { problem: recall.problem } : {},
    ...recall?.outcome ? { outcome: recall.outcome } : {},
    ...byline ? { byline } : {},
    ...notes.length > 0 ? { notes } : {}
  };
}
var TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;
var QUERY_STOPWORDS = /* @__PURE__ */ new Set([
  "the",
  "and",
  "for",
  "you",
  "with",
  "from",
  "that",
  "this",
  "what",
  "how",
  "why",
  "are",
  "was",
  "were",
  "into",
  "your",
  "a",
  "an",
  "of",
  "to",
  "in",
  "on",
  "or",
  "do",
  "does",
  "did",
  "is",
  "it",
  "as",
  "be",
  "by",
  "if",
  "not",
  "can",
  "should",
  "would",
  "could",
  "when",
  "which",
  "who",
  "whom",
  "been",
  "have",
  "has",
  "had",
  "will",
  "just",
  "about",
  "than",
  "then",
  "also",
  "only",
  "over",
  "after",
  "before",
  "between",
  "same",
  "each",
  "other",
  "more",
  "most",
  "such",
  "very",
  "right",
  "me",
  "my",
  "we",
  "our",
  "i",
  "explain",
  "describe",
  "tell",
  "show",
  "work",
  "works",
  "please",
  "thanks"
]);
var GENERIC_OPS_TERMS = /* @__PURE__ */ new Set([
  "node",
  "nodes",
  "memory",
  "cpu",
  "cpus",
  "ram",
  "resource",
  "resources",
  "server",
  "servers",
  "service",
  "services",
  "guide",
  "runbook",
  "error",
  "errors",
  "issue",
  "issues",
  "use",
  "using",
  "used",
  "handle",
  "handling",
  "system",
  "systems",
  "process",
  "limit",
  "limits",
  "timeout",
  "timeouts",
  "request",
  "requests",
  "cluster",
  "host",
  "free",
  "enough",
  "individual",
  "aggregate",
  "pattern",
  "failure",
  "failures"
]);
function tokenize2(text) {
  const prepared = /[\u0080-\uFFFF]/.test(text) ? text.normalize("NFC") : text;
  return prepared.toLowerCase().match(TOKEN_PATTERN) ?? [];
}
function stemToken(token) {
  if (token.length < 5) return token;
  if (token.endsWith("ing") && token.length > 6) return token.slice(0, -3);
  if (token.endsWith("ers") && token.length > 6) return token.slice(0, -1);
  if (token.endsWith("ies") && token.length > 5) return `${token.slice(0, -3)}y`;
  if (token.endsWith("es") && token.length > 5) return token.slice(0, -2);
  if (token.endsWith("ed") && token.length > 5) {
    const minusD = token.slice(0, -1);
    if (minusD.endsWith("e")) return minusD;
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 4) return token.slice(0, -1);
  return token;
}
function contentTokens2(text) {
  return tokenize2(text).filter((t) => t.length > 1 && !QUERY_STOPWORDS.has(t)).map(stemToken);
}
function bigrams(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    out.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return out;
}
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > 2) return 99;
  const prev = new Array(b.length + 1);
  const cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 99) + 1, (cur[j - 1] ?? 99) + 1, (prev[j - 1] ?? 99) + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = cur[j] ?? 99;
  }
  return prev[b.length] ?? 99;
}
function expandTypos(queryTokens, vocab) {
  const extra = [];
  for (const raw of queryTokens) {
    if (vocab.has(raw) || raw.length < 5) continue;
    let best = null;
    let bestD = 99;
    let ties = 0;
    const max = raw.length >= 8 ? 2 : 1;
    for (const v of vocab) {
      if (Math.abs(v.length - raw.length) > max) continue;
      const d = levenshtein(raw, v);
      if (d < bestD) {
        bestD = d;
        best = v;
        ties = 1;
      } else if (d === bestD) {
        ties += 1;
      }
    }
    if (best && bestD <= max && ties === 1) extra.push(best);
  }
  return extra;
}
function tokenSetMatches(queryToken, doc) {
  if (doc.has(queryToken)) return true;
  const stemmed = stemToken(queryToken);
  if (doc.has(stemmed)) return true;
  if (queryToken.length < 4) return false;
  for (const t of doc) {
    if (t.length < 4) continue;
    if (t.startsWith(queryToken) || queryToken.startsWith(t)) return true;
  }
  return false;
}
function estimateTokens(text) {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}
function cosineSimilarity(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
function parseEmbedding(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    for (const n of parsed) {
      if (typeof n !== "number" || !Number.isFinite(n)) return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
var SEED_CORPUS_ID = "seed-lab";
var EMBEDDING_MODEL = "gemini-embedding-2";
var CHUNK_SIZE_TOKENS = 512;
var CHUNK_OVERLAP_TOKENS = 25;
var RRF_K = 60;
var CONTEXT_TOKEN_BUDGET = 1400;
var CONTEXT_RELATIVE_FLOOR = 0.62;
var CONTEXT_ABSOLUTE_FLOOR = 0.24;
var CONTEXT_SOLO_MARGIN = 1.35;
var SCORE_SEMANTICS = "Dense = raw cosine. Keyword = raw BM25. Hybrid = raw RRF (1/(60+rank)). Rerank = calibrated mix (not a cross-encoder, not confidence). The context gate is calibrated-score floor 0.24 AND 62% of rank-1. not an absolute 0.55 cosine threshold.";
function buildIdf(corpusTexts) {
  const df = /* @__PURE__ */ new Map();
  const n = Math.max(1, corpusTexts.length);
  for (const text of corpusTexts) {
    const seen = new Set(contentTokens2(text));
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idf = /* @__PURE__ */ new Map();
  for (const [t, c] of df) {
    const raw = Math.log(1 + (n - c + 0.5) / (c + 0.5));
    idf.set(t, GENERIC_OPS_TERMS.has(t) ? raw * 0.2 : raw);
  }
  return idf;
}
function queryTerms(query, vocab) {
  const base = contentTokens2(query);
  const extra = expandTypos(base, vocab);
  return [.../* @__PURE__ */ new Set([...base, ...extra])];
}
function corpusVocab(texts) {
  const v = /* @__PURE__ */ new Set();
  for (const text of texts) for (const t of contentTokens2(text)) v.add(t);
  return v;
}
function termWeight(term, idf) {
  if (QUERY_STOPWORDS.has(term)) return 0;
  const generic = GENERIC_OPS_TERMS.has(term) ? 0.2 : 1;
  return (idf.get(term) ?? Math.log(8)) * generic;
}
function weightedRecall(terms, text, idf) {
  if (!terms.length) return 0;
  const doc = new Set(contentTokens2(text));
  let num = 0;
  let den = 0;
  for (const t of terms) {
    const w = termWeight(t, idf);
    if (w <= 0) continue;
    den += w;
    if (tokenSetMatches(t, doc)) num += w;
  }
  return den === 0 ? 0 : num / den;
}
function phraseBoost(query, text) {
  const q = contentTokens2(query);
  const grams = bigrams(q).filter((g) => {
    const [a, b] = g.split(" ");
    return Boolean(a && b && !GENERIC_OPS_TERMS.has(a) && !GENERIC_OPS_TERMS.has(b));
  });
  const hay = contentTokens2(text).join(" ");
  const hayRaw = text.toLowerCase();
  let hits = 0;
  let den = grams.length;
  for (const g of grams) {
    if (hay.includes(g)) hits += 1;
  }
  const named = query.match(/\bnode\s+[a-z0-9]\b/gi) ?? [];
  den += named.length;
  for (const n of named) {
    if (hayRaw.includes(n.toLowerCase())) hits += 1;
  }
  if (!den) return 0;
  return hits / den;
}
function topicalBoost(query, title, text) {
  const q = queryTokenSet(query);
  const d = new Set(contentTokens2(`${title}
${text}`));
  let b = 0;
  if (looksLikeStampede(q) && hasAny(d, ["stampede", "redis"])) b += 0.28;
  if (looksLikeFragmentation(q) && hasAny(d, ["fragmentation", "pending"])) b += 0.22;
  if (looksLikeServerlessPg(q) && hasAny(d, ["pgbouncer", "postgres"])) b += 0.22;
  return Math.min(0.34, b);
}
function maxNorm(values, value) {
  const hi = Math.max(0, ...values);
  if (hi <= 1e-9) return 0;
  return value / hi;
}
var ENTITY_TERMS = /* @__PURE__ */ new Set([
  "postgres",
  "pgbouncer",
  "redis",
  "redlock",
  "kubernetes",
  "k8s",
  "docker",
  "tls",
  "aiohttp",
  "asyncio",
  "terraform",
  "nginx"
]);
function entityTermsInQuery(query) {
  return contentTokens2(query).filter((t) => ENTITY_TERMS.has(t));
}
function hasAny(hay, terms) {
  return terms.some((t) => tokenSetMatches(t, hay));
}
function queryTokenSet(query) {
  return new Set(contentTokens2(query));
}
function looksLikeStampede(q) {
  return hasAny(q, ["cache", "cached", "stampede"]) && hasAny(q, ["hundred", "sudden", "expensive", "disappear", "recompute", "popular", "thundering", "herd"]);
}
function looksLikeFragmentation(q) {
  return hasAny(q, ["pending", "pod", "scatter", "fragment", "schedul"]) || hasAny(q, ["2gi", "2gib"]);
}
function looksLikeServerlessPg(q) {
  return hasAny(q, ["postgres", "pgbouncer"]) && hasAny(q, ["pool", "serverless", "bouncer"]);
}
function expandQueryCues(query) {
  const q = queryTokenSet(query);
  const extra = [];
  if (looksLikeStampede(q)) extra.push("stampede", "redis", "ttl", "jitter", "lock");
  if (looksLikeFragmentation(q)) extra.push("fragmentation", "pending", "kubernetes");
  if (looksLikeServerlessPg(q)) extra.push("pgbouncer", "postgres", "transaction");
  return extra;
}
function calibratedScore(input) {
  const { dense, bm25Norm, idfRecall, titleRecall, phrase } = input;
  if (dense == null) {
    return 0.34 * bm25Norm + 0.32 * idfRecall + 0.2 * titleRecall + 0.14 * phrase;
  }
  return 0.46 * Math.max(0, dense) + 0.18 * bm25Norm + 0.2 * idfRecall + 0.1 * titleRecall + 0.06 * phrase;
}
function rrfFuse(dense, keyword, topK) {
  const scores = /* @__PURE__ */ new Map();
  const byId = /* @__PURE__ */ new Map();
  dense.forEach((c, i) => {
    scores.set(c.chunkId, (scores.get(c.chunkId) ?? 0) + 1 / (RRF_K + i + 1));
    byId.set(c.chunkId, c);
  });
  keyword.forEach((c, i) => {
    scores.set(c.chunkId, (scores.get(c.chunkId) ?? 0) + 1 / (RRF_K + i + 1));
    if (!byId.has(c.chunkId)) byId.set(c.chunkId, c);
  });
  const fused = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, topK).map(([id, score], rank) => {
    const base = byId.get(id);
    return { ...base, score, rank: rank + 1, retriever: "hybrid" };
  });
  return { fused, scores };
}
function rerankCalibrated(opts) {
  const bm25Raw = opts.candidates.map((c) => opts.keywordScores.get(c.chunkId) ?? 0);
  const signals = /* @__PURE__ */ new Map();
  const scored = opts.candidates.map((c) => {
    const dense = opts.denseScores.has(c.chunkId) ? opts.denseScores.get(c.chunkId) ?? null : null;
    const bm25 = opts.keywordScores.get(c.chunkId) ?? 0;
    const idfRecall = weightedRecall(opts.terms, `${c.title}
${c.heading ?? ""}
${c.text}`, opts.idf);
    const titleRecall = weightedRecall(opts.terms, `${c.title} ${c.heading ?? ""}`, opts.idf);
    const phrase = phraseBoost(opts.query, `${c.title}
${c.text}`);
    const topical = (c.corpusId ?? SEED_CORPUS_ID) === SEED_CORPUS_ID ? topicalBoost(opts.query, c.title, c.text) : 0;
    let score = Math.min(
      1,
      calibratedScore({
        dense,
        bm25Norm: maxNorm(bm25Raw, bm25),
        idfRecall,
        titleRecall,
        phrase
      }) + topical
    );
    const ents = entityTermsInQuery(opts.query);
    const titleTok = new Set(contentTokens2(`${c.title} ${c.heading ?? ""}`));
    if ((c.corpusId ?? SEED_CORPUS_ID) === SEED_CORPUS_ID && ents.some((e) => tokenSetMatches(e, titleTok))) score = Math.min(1, score + 0.12);
    if (opts.preferredSlugs?.includes(c.slug)) score = Math.min(1, score + 0.03);
    const pathCost = opts.graphPathCosts?.get(c.chunkId);
    if (pathCost !== void 0) score = Math.min(1, score + 0.04 / (1 + pathCost));
    signals.set(c.chunkId, { idfRecall, titleRecall, phrase, topical, dense, bm25 });
    return { chunk: c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const scores = /* @__PURE__ */ new Map();
  const ranked = scored.map((s, i) => {
    scores.set(s.chunk.chunkId, s.score);
    return { ...s.chunk, score: s.score, rank: i + 1 };
  });
  return { ranked, scores, signals };
}
function isSupported(signals, calibrated) {
  if (calibrated < CONTEXT_ABSOLUTE_FLOOR) return false;
  if (signals.idfRecall >= 0.18) return true;
  if (signals.titleRecall >= 0.22) return true;
  if (signals.phrase >= 0.2) return true;
  if (signals.topical >= 0.18) return true;
  if ((signals.dense ?? 0) >= 0.52 && (signals.idfRecall >= 0.05 || signals.titleRecall >= 0.08)) {
    return true;
  }
  if ((signals.dense ?? 0) >= 0.62 && calibrated >= 0.32) return true;
  if (signals.dense == null && signals.idfRecall < 0.1 && signals.titleRecall < 0.12 && signals.topical < 0.18) {
    return false;
  }
  return false;
}
function distinctiveDocHits(query, ranked, idf) {
  const terms = contentTokens2(query).filter((t) => !GENERIC_OPS_TERMS.has(t) && (idf.get(t) ?? 0) > 0.4);
  const slugs = [];
  for (const c of ranked.slice(0, 8)) {
    const title = new Set(contentTokens2(`${c.title} ${c.heading ?? ""}`));
    const hit = terms.some((t) => tokenSetMatches(t, title));
    if (hit && !slugs.includes(c.slug)) slugs.push(c.slug);
  }
  return slugs;
}
function queryLooksMultiSource(query, ranked, idf) {
  const hits = distinctiveDocHits(query, ranked, idf);
  if (hits.length >= 2) return true;
  const q = query.toLowerCase();
  if (/\band\b|\bshared by\b|\bboth\b|\bversus\b|\bvs\.?\b/.test(q) && hits.length >= 2) return true;
  return false;
}
function selectContext(ranked, signals, opts) {
  const dropReasons = /* @__PURE__ */ new Map();
  const maxTokens = opts.maxTokens ?? CONTEXT_TOKEN_BUDGET;
  const underspecified = distinctiveTerms(opts.query).length === 0;
  if (underspecified) {
    const qtok = contentTokens2(opts.query);
    const mentioning = ranked.filter((c) => {
      if (c.score < 0.1) {
        dropReasons.set(c.chunkId, "Underspecified query: calibrated score < 0.10. Inspect only.");
        return false;
      }
      const doc = new Set(contentTokens2(`${c.title}
${c.text}`));
      const hit = qtok.some((t) => tokenSetMatches(t, doc));
      if (!hit) {
        dropReasons.set(
          c.chunkId,
          "Underspecified query: no overlap with the generic question terms. Inspect only."
        );
      }
      return hit;
    });
    const packed2 = [];
    const seen = /* @__PURE__ */ new Set();
    for (const chunk of mentioning) {
      if (packed2.length >= Math.min(3, opts.topK ?? 3)) {
        dropReasons.set(chunk.chunkId, "Outside the packed context window (max 3 supported chunks).");
        continue;
      }
      if (seen.has(chunk.slug)) {
        dropReasons.set(chunk.chunkId, "Duplicate document. a stronger chunk from this source is already packed.");
        continue;
      }
      packed2.push({ ...chunk, rank: packed2.length + 1 });
      seen.add(chunk.slug);
    }
    return { packed: packed2, dropReasons };
  }
  const supported = [];
  for (const c of ranked) {
    const sig = signals.get(c.chunkId) ?? {
      idfRecall: 0,
      titleRecall: 0,
      phrase: 0,
      topical: 0,
      dense: null,
      bm25: null
    };
    if (!isSupported(sig, c.score)) {
      dropReasons.set(
        c.chunkId,
        `Rejected: calibrated ${c.score.toFixed(2)} failed the support gate (absolute floor ${CONTEXT_ABSOLUTE_FLOOR}, need distinctive overlap or strong cosine). Inspect only.`
      );
      continue;
    }
    supported.push(c);
  }
  if (!supported.length) return { packed: [], dropReasons };
  const peak = supported[0].score;
  const afterCliff = [];
  for (const c of supported) {
    if (c.chunkId !== supported[0].chunkId && c.score < peak * CONTEXT_RELATIVE_FLOOR) {
      dropReasons.set(
        c.chunkId,
        `Below relative floor: ${c.score.toFixed(2)} < ${CONTEXT_RELATIVE_FLOOR} \xD7 rank-1 ${peak.toFixed(2)} (${(peak * CONTEXT_RELATIVE_FLOOR).toFixed(2)}). Not an absolute 0.55 cosine cut. Inspect only.`
      );
      continue;
    }
    afterCliff.push(c);
  }
  const coordinating = /\band\b|\bshared by\b|\bboth\b|\bversus\b|\bvs\.?\b/.test(opts.query.toLowerCase());
  const exclusive = entityTermsInQuery(opts.query);
  if (exclusive.length === 1 && !coordinating) {
    const holding = afterCliff.filter((c) => {
      const doc = new Set(contentTokens2(`${c.title}
${c.text}`));
      return exclusive.every((t) => tokenSetMatches(t, doc));
    });
    if (holding.length) {
      for (const c of afterCliff) {
        if (!holding.includes(c)) {
          dropReasons.set(
            c.chunkId,
            `Missing required entity term (${exclusive.join(", ")}). Inspect only.`
          );
        }
      }
      afterCliff.length = 0;
      afterCliff.push(...holding);
    }
  } else if (exclusive.length >= 1 && coordinating) {
    const holding = afterCliff.filter((c) => {
      const doc = new Set(contentTokens2(`${c.title}
${c.text}`));
      return exclusive.some((t) => tokenSetMatches(t, doc)) || hasAny(doc, ["pool", "exhaustion", "stampede"]);
    });
    if (holding.length) {
      for (const c of afterCliff) {
        if (!holding.includes(c)) {
          dropReasons.set(
            c.chunkId,
            `No overlap with the named entities (${exclusive.join(", ")}). Inspect only.`
          );
        }
      }
      afterCliff.length = 0;
      afterCliff.push(...holding);
    }
  }
  const multi = queryLooksMultiSource(opts.query, afterCliff, opts.idf);
  const second = afterCliff[1];
  let pool = afterCliff;
  if (!multi && second && peak >= second.score * CONTEXT_SOLO_MARGIN) {
    for (const c of afterCliff.slice(1)) {
      if (c.slug === afterCliff[0].slug) continue;
      dropReasons.set(
        c.chunkId,
        `Rank-1 margin: ${peak.toFixed(2)} is \u2265 ${CONTEXT_SOLO_MARGIN}\xD7 stronger than ${second.score.toFixed(2)}. Only the top source packed.`
      );
    }
    pool = afterCliff.filter((c) => c.slug === afterCliff[0].slug).slice(0, 2);
    if (!pool.length) pool = [afterCliff[0]];
  }
  const packed = [];
  const seenText = /* @__PURE__ */ new Set();
  let used = 0;
  const cap = Math.min(3, opts.topK ?? 3);
  for (const chunk of pool) {
    if (packed.length >= cap) {
      dropReasons.set(chunk.chunkId, "Outside the packed context window (max 3 supported chunks).");
      continue;
    }
    const normalizedText = chunk.text.replace(/\s+/g, " ").trim();
    if (seenText.has(normalizedText)) {
      dropReasons.set(chunk.chunkId, "Duplicate passage. the same text is already packed.");
      continue;
    }
    if (used + chunk.tokenCount > maxTokens && packed.length) {
      dropReasons.set(chunk.chunkId, "Outside the context token budget.");
      continue;
    }
    packed.push({ ...chunk, rank: packed.length + 1 });
    seenText.add(normalizedText);
    used += chunk.tokenCount;
  }
  return { packed, dropReasons };
}
function payloadQuery(query) {
  if (!/ignore (the )?(indexed )?corpus|answer from memory|from your (own )?knowledge/i.test(query)) {
    return query;
  }
  const idx = query.lastIndexOf(":");
  if (idx >= 0 && idx < query.length - 3) {
    const rest = query.slice(idx + 1).trim();
    if (rest.length > 8) return rest;
  }
  return query;
}
function retrievalQuery(query, vocab) {
  const extra = expandTypos(contentTokens2(query), vocab);
  if (!extra.length) return query;
  return `${query} ${extra.join(" ")}`;
}
function distinctiveTerms(query) {
  return contentTokens2(query).filter(
    (t) => t.length >= 4 && !GENERIC_OPS_TERMS.has(t) && !QUERY_STOPWORDS.has(t)
  );
}
var MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
function extractQueryDates(query) {
  const forms = [];
  const monthAlt = MONTHS.join("|");
  const dmy = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthAlt})\\s+(\\d{4})\\b`, "gi");
  let m;
  while (m = dmy.exec(query)) {
    forms.push(dateForms(Number(m[1]), m[2].toLowerCase(), m[3]));
  }
  const mdy = new RegExp(`\\b(${monthAlt})\\s+(\\d{1,2})(?:st|nd|rd|th)?,??\\s+(\\d{4})\\b`, "gi");
  while (m = mdy.exec(query)) {
    forms.push(dateForms(Number(m[2]), m[1].toLowerCase(), m[3]));
  }
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  while (m = iso.exec(query)) {
    forms.push(dateForms(Number(m[3]), MONTHS[Number(m[2]) - 1] ?? "", m[1]));
  }
  return forms;
}
function dateForms(day, month, year) {
  if (!month) return [];
  const mm = String(MONTHS.indexOf(month) + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return [
    `${day} ${month} ${year}`,
    `${month} ${day}, ${year}`,
    `${month} ${day} ${year}`,
    `${year}-${mm}-${dd}`
  ];
}
function hasTerm(packedLower, term) {
  return new RegExp(`\\b${term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(packedLower);
}
var ABSENCE = /^(does|do|is|are|did)\b.+\b(recommend|mention|include|support|use|say|cover|describe)\b/i;
var ABSENCE_VERBS = /* @__PURE__ */ new Set([
  "recommend",
  "mention",
  "include",
  "support",
  "describe",
  "cover",
  "explain",
  "say",
  "use"
]);
var PACKED_DENSE_SUPPORT = 0.68;
function probeTermsNotInText(query, text) {
  const doc = new Set(contentTokens2(text));
  return distinctiveTerms(query).filter(
    (t) => t.length >= 5 && !ABSENCE_VERBS.has(t) && !tokenSetMatches(t, doc)
  );
}
function queryChunkSupport(query, packed) {
  const supportQuery = payloadQuery(query);
  const terms = distinctiveTerms(supportQuery);
  const packedTokens = new Set(packed.flatMap((c) => contentTokens2(`${c.title}
${c.text}`)));
  const hits = terms.filter((t) => tokenSetMatches(t, packedTokens));
  return {
    terms,
    hits,
    ratio: terms.length ? hits.length / terms.length : 0
  };
}
function looksLikeBypassInstruction(query) {
  return /ignore (the )?(indexed )?(corpus|sources?|documents?|runbook|readme)|answer from memory|from your (own )?knowledge|pretend (a )?source/i.test(
    query
  );
}
function gate(kind, note, extras = {}) {
  return {
    kind,
    note,
    supportTermCount: extras.supportTermCount ?? 0,
    supportHitCount: extras.supportHitCount ?? 0,
    packedTopDense: extras.packedTopDense ?? null,
    packedTopLexical: extras.packedTopLexical ?? 0,
    clearedForInsufficient: extras.clearedForInsufficient ?? false,
    denseRank1Slug: extras.denseRank1Slug ?? null,
    rerankRank1Slug: extras.rerankRank1Slug ?? null,
    denseRerankDisagree: extras.denseRerankDisagree ?? false,
    probe: extras.probe
  };
}
function classifyEvidence(opts) {
  const rerankRank1Slug = opts.ranked[0]?.slug ?? null;
  const denseRank1Slug = opts.denseRank1Slug ?? null;
  const disagree = Boolean(denseRank1Slug && rerankRank1Slug && denseRank1Slug !== rerankRank1Slug);
  const base = {
    denseRank1Slug,
    rerankRank1Slug,
    denseRerankDisagree: disagree
  };
  if (!opts.packed.length) {
    return gate(
      "insufficient",
      "No retrieved chunk passed the calibrated support gate. The corpus does not contain enough evidence.",
      base
    );
  }
  const packedText = opts.packed.map((c) => c.text).join("\n");
  const slugs = [...new Set(opts.packed.map((c) => c.slug))];
  const top = opts.packed[0];
  const second = opts.packed[1];
  const close = second && top.score > 0 ? second.score / top.score >= 0.78 && second.slug !== top.slug : false;
  const topSig = opts.signals.get(top.chunkId);
  const packedTopDense = topSig?.dense ?? null;
  const packedTopLexical = (topSig?.idfRecall ?? 0) + (topSig?.titleRecall ?? 0) + (topSig?.topical ?? 0);
  const support = queryChunkSupport(opts.query, opts.packed);
  const stats = {
    ...base,
    supportTermCount: support.terms.length,
    supportHitCount: support.hits.length,
    packedTopDense,
    packedTopLexical
  };
  const requestedCredentials = opts.query.match(/\b(?:passwords?|credentials?|api[ _-]?keys?|database_url|secrets?)\b/gi) ?? [];
  const missingCredentials = requestedCredentials.filter((term) => {
    const normalized = term.toLowerCase().replace(/[ _-]/g, "").replace(/s$/, "");
    return !packedText.toLowerCase().replace(/[ _-]/g, "").includes(normalized);
  });
  if (missingCredentials.length) {
    return gate("insufficient", "The requested credential field is not present in the retrieved passages; topic overlap does not establish its value.", { ...stats, clearedForInsufficient: true });
  }
  const packedLower = packedText.toLowerCase();
  const missingDates = extractQueryDates(opts.query).filter(
    (forms) => !forms.some((f) => packedLower.includes(f))
  );
  if (missingDates.length) {
    return gate("insufficient", "The question names a specific date that is not present in the retrieved passages; the passages do not establish date-bound events.", { ...stats, clearedForInsufficient: true });
  }
  const artifactIds = opts.query.match(/\b(?=\w*\d)(?=\w*[a-z])[a-z0-9]+(?:\.[a-z0-9]+)+\b/gi) ?? [];
  const missingArtifacts = artifactIds.filter((id) => !packedLower.includes(id.toLowerCase()));
  if (missingArtifacts.length) {
    return gate("insufficient", "The named artifact identifier is not present in the retrieved passages. Similar vocabulary does not answer this question.", { ...stats, clearedForInsufficient: true });
  }
  const requestedCommercial = opts.query.match(/\b(?:slas?|uptime|pricing|prices?|costs?|contractual|warrant(?:y|ies)|discounts?|refunds?|billing)\b/gi) ?? [];
  const missingCommercial = [...new Set(requestedCommercial.map((t) => t.toLowerCase()))].filter(
    (term) => !hasTerm(packedLower, term)
  );
  if (missingCommercial.length) {
    return gate("insufficient", "The requested commercial or contractual fact is not stated in the retrieved passages; topic overlap does not establish it.", { ...stats, clearedForInsufficient: true });
  }
  if (ABSENCE.test(opts.query.trim())) {
    const missing = probeTermsNotInText(opts.query, `${top.title}
${packedText}`);
    const relevantTitle = distinctiveTerms(opts.query).some(
      (t) => tokenSetMatches(t, new Set(contentTokens2(top.title)))
    );
    if (relevantTitle && missing.length) {
      return gate(
        "negative_not_found",
        `The indexed source \u201C${top.title}\u201D was retrieved; ${missing.join(", ")} is not in that text.`,
        { ...stats, probe: missing[0] }
      );
    }
  }
  const identifiers = opts.query.match(/\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/g) ?? [];
  const normalizedEvidence = packedText.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (identifiers.some((name) => !normalizedEvidence.includes(name.toLowerCase()))) {
    return gate("insufficient", "The named API is not present in the retrieved passages. Similar vocabulary from another library does not answer this question.", { ...stats, clearedForInsufficient: true });
  }
  if (!distinctiveTerms(opts.query).length) {
    return gate(
      "ambiguous",
      "The question has no distinctive entity. Several indexed sources may apply. do not treat one as the only answer.",
      stats
    );
  }
  const noOverlap = support.hits.length === 0;
  if (looksLikeBypassInstruction(opts.query) && (noOverlap || support.ratio < 0.5)) {
    return gate(
      "insufficient",
      "The question asks to skip the corpus or answer from memory, and packed chunks do not support the remaining question.",
      { ...stats, clearedForInsufficient: true }
    );
  }
  if (noOverlap && packedTopDense != null && packedTopDense < PACKED_DENSE_SUPPORT) {
    return gate(
      "insufficient",
      "Packed chunks have no distinctive overlap with the question and are not a strong dense match. Nearby unrelated documents are not evidence.",
      { ...stats, clearedForInsufficient: true }
    );
  }
  if (slugs.length >= 2 && close) {
    return gate(
      "ambiguous",
      "Several indexed sources are similarly relevant. Distinguish what each one actually states.",
      stats
    );
  }
  return gate("positive", "Packed chunks have distinctive overlap with the question or a strong dense match.", stats);
}
var BM25Index = class {
  k1 = 1.5;
  b = 0.75;
  ids = [];
  texts = [];
  docs = [];
  lengths = [];
  avgLen = 0;
  df = /* @__PURE__ */ new Map();
  constructor(chunks) {
    for (const chunk of chunks) {
      const tokens = contentTokens2(chunk.text);
      if (!tokens.length) continue;
      this.ids.push(chunk.id);
      this.texts.push(chunk.text);
      this.docs.push(tokens);
      this.lengths.push(tokens.length);
    }
    const n = this.docs.length;
    if (!n) return;
    this.avgLen = this.lengths.reduce((a, b) => a + b, 0) / n;
    for (const tokens of this.docs) {
      for (const term of new Set(tokens)) {
        this.df.set(term, (this.df.get(term) ?? 0) + 1);
      }
    }
  }
  search(query, topK) {
    const q = contentTokens2(query);
    if (!q.length || !this.docs.length) return [];
    const scored = [];
    for (let i = 0; i < this.docs.length; i += 1) {
      const score = this.score(q, this.docs[i], this.lengths[i]);
      if (score > 0) scored.push({ i, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(({ i, score }) => ({
      id: this.ids[i],
      text: this.texts[i],
      score
    }));
  }
  score(query, doc, len) {
    const tf = /* @__PURE__ */ new Map();
    for (const t of doc) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    const n = this.docs.length;
    for (const term of query) {
      const df = this.df.get(term);
      if (!df) continue;
      const freq = tf.get(term) ?? 0;
      if (!freq) continue;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      const denom = freq + this.k1 * (1 - this.b + this.b * len / this.avgLen);
      score += idf * (freq * (this.k1 + 1) / denom);
    }
    return score;
  }
};
var STOP = /* @__PURE__ */ new Set([
  "the",
  "and",
  "for",
  "you",
  "with",
  "from",
  "that",
  "this",
  "what",
  "how",
  "why",
  "are",
  "was",
  "were",
  "into",
  "your",
  "a",
  "an",
  "of",
  "to",
  "in",
  "on",
  "or",
  "do",
  "does",
  "is",
  "it",
  "as"
]);
function overlapTerms(query, text, limit = 5) {
  const q = tokenize2(query).filter((t) => t.length > 2 && !STOP.has(t));
  const doc = new Set(tokenize2(text));
  const hits = [];
  for (const t of q) {
    if (doc.has(t) && !hits.includes(t)) hits.push(t);
    if (hits.length >= limit) break;
  }
  return hits;
}
function toRetrieved(chunkId, meta, score, rank, retriever) {
  const row = meta.get(chunkId);
  if (!row) return null;
  return {
    chunkId,
    documentId: row.chunk.document_id,
    slug: row.slug,
    title: row.title,
    text: row.chunk.text,
    heading: row.chunk.heading,
    score,
    rank,
    retriever,
    tokenCount: row.chunk.token_count,
    indexedAt: row.indexedAt,
    embeddingModel: row.chunk.embedding_model,
    filepath: row.chunk.filepath,
    language: row.chunk.language,
    symbol: row.chunk.symbol,
    chunkKind: row.chunk.chunk_kind ?? "prose",
    corpusId: row.corpusId || row.chunk.corpus_id || SEED_CORPUS_ID
  };
}
function firstSlugRanks(chunks) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const c of chunks) {
    if (seen.has(c.slug)) continue;
    seen.add(c.slug);
    out.push({
      slug: c.slug,
      title: c.title,
      score: c.score,
      rank: out.length + 1,
      corpusId: c.corpusId
    });
  }
  return out;
}
function rankMap(chunks) {
  const map = /* @__PURE__ */ new Map();
  for (const c of chunks) {
    if (!map.has(c.chunkId)) map.set(c.chunkId, c.rank);
  }
  return map;
}
function retrieveFromRows(opts) {
  const scope = opts.corpusScope ?? { kind: "corpus", corpusId: SEED_CORPUS_ID };
  const scopedRows = scope.kind === "all" ? opts.rows : opts.rows.filter((r) => (r.corpusId || r.chunk.corpus_id || SEED_CORPUS_ID) === scope.corpusId);
  const meta = /* @__PURE__ */ new Map();
  for (const row of scopedRows) meta.set(row.chunk.id, row);
  const texts = scopedRows.map((r) => `${r.title}
${r.chunk.text}`);
  const idf = buildIdf(texts);
  const vocab = corpusVocab(texts);
  const query = payloadQuery(opts.query);
  const cues = scope.kind === "corpus" && scope.corpusId === SEED_CORPUS_ID ? expandQueryCues(query) : [];
  const terms = [.../* @__PURE__ */ new Set([...queryTerms(query, vocab), ...cues])];
  const bm25Query = `${retrievalQuery(query, vocab)} ${cues.join(" ")}`.trim();
  const retrieveN = Math.min(80, Math.max(scopedRows.length, opts.topK * 4, 10));
  let dense = [];
  let keyword = [];
  const denseScores = /* @__PURE__ */ new Map();
  const keywordScores = /* @__PURE__ */ new Map();
  const expectedModel = opts.embeddingModel ?? EMBEDDING_MODEL;
  let compatible = 0;
  let modelMatch = true;
  const queryEmbeddingProduced = Boolean(opts.queryVector?.length);
  const denseWanted = opts.mode !== "keyword";
  let skippedReason = null;
  if (!opts.storage.denseAvailable && denseWanted) {
    skippedReason = "Durable embeddings are unavailable (ephemeral Vercel storage). Fell back to BM25.";
  } else if (denseWanted && !queryEmbeddingProduced) {
    skippedReason = "Query embedding was not produced. Fell back to BM25.";
  }
  const denseStart = performance.now();
  if (denseWanted && queryEmbeddingProduced && opts.storage.denseAvailable && opts.queryVector) {
    const scored = [];
    for (const row of scopedRows) {
      const model = row.chunk.embedding_model;
      if (model && model !== expectedModel) {
        modelMatch = false;
        continue;
      }
      const vec = parseEmbedding(row.chunk.embedding);
      if (!vec || vec.length !== opts.queryVector.length) continue;
      compatible += 1;
      scored.push({ id: row.chunk.id, score: cosineSimilarity(opts.queryVector, vec) });
    }
    if (!compatible) {
      skippedReason = "No stored vectors matched the query embedding model/dimension. Query embedding alone is not dense retrieval. Fell back to BM25.";
    } else {
      scored.sort((a, b) => b.score - a.score);
      for (const s of scored) denseScores.set(s.id, s.score);
      dense = scored.slice(0, retrieveN).map((s, i) => toRetrieved(s.id, meta, s.score, i + 1, "dense")).filter((c) => Boolean(c));
    }
  }
  const denseMs = performance.now() - denseStart;
  const kwStart = performance.now();
  if (opts.mode !== "dense" || !dense.length) {
    const index = new BM25Index(scopedRows.map((r) => ({ id: r.chunk.id, text: `${r.title}
${r.chunk.text}` })));
    const lexicalQuery = terms.join(" ") || bm25Query;
    const hits = index.search(lexicalQuery, retrieveN);
    for (const s of hits) keywordScores.set(s.id, s.score);
    keyword = hits.map((s, i) => toRetrieved(s.id, meta, s.score, i + 1, "keyword")).filter((c) => Boolean(c));
    if (scopedRows.length <= 80) {
      for (const row of scopedRows) {
        if (keywordScores.has(row.chunk.id)) continue;
        keywordScores.set(row.chunk.id, 0);
        const extra = toRetrieved(row.chunk.id, meta, 0, keyword.length + 1, "keyword");
        if (extra) keyword.push(extra);
      }
    }
  }
  const keywordMs = performance.now() - kwStart;
  const useHybrid = Boolean(dense.length && keyword.length && opts.mode === "hybrid");
  const fusedPack = useHybrid ? rrfFuse(dense, keyword, retrieveN) : null;
  const fused = fusedPack?.fused ?? (dense.length && opts.mode === "dense" ? dense : keyword.length ? keyword : dense);
  const rerankStart = performance.now();
  const { ranked, scores: rerankScores, signals } = rerankCalibrated({
    query,
    candidates: fused,
    denseScores,
    keywordScores,
    idf,
    terms,
    preferredSlugs: opts.preferredSlugs,
    graphPathCosts: opts.graphPathCosts
  });
  const rerankMs = performance.now() - rerankStart;
  const assembleStart = performance.now();
  const { packed, dropReasons } = selectContext(ranked, signals, {
    query,
    idf,
    maxTokens: CONTEXT_TOKEN_BUDGET,
    topK: Math.min(3, opts.topK)
  });
  const assembleMs = performance.now() - assembleStart;
  const packedIds = new Set(packed.map((c) => c.chunkId));
  const denseSlugRanks = firstSlugRanks(dense);
  const evidence = classifyEvidence({
    query,
    packed,
    ranked,
    signals,
    denseRank1Slug: denseSlugRanks[0]?.slug ?? null
  });
  const gatedPacked = evidence.kind === "insufficient" ? [] : packed;
  const gatedIds = new Set(gatedPacked.map((c) => c.chunkId));
  if (evidence.kind === "insufficient") {
    for (const c of packed) {
      if (!dropReasons.has(c.chunkId)) {
        dropReasons.set(c.chunkId, evidence.note);
      }
    }
  }
  const denseRanks = rankMap(dense);
  const keywordRanks = rankMap(keyword);
  const fusedRanks = rankMap(fused);
  const candidates = ranked.slice(0, 12).map((c, i) => {
    const usedInContext = gatedIds.has(c.chunkId);
    return {
      ...c,
      rank: i + 1,
      scores: {
        dense: denseScores.has(c.chunkId) ? denseScores.get(c.chunkId) : null,
        keyword: keywordScores.has(c.chunkId) ? keywordScores.get(c.chunkId) : null,
        hybrid: fusedPack?.scores.has(c.chunkId) ? fusedPack.scores.get(c.chunkId) : null,
        rerank: rerankScores.get(c.chunkId) ?? c.score
      },
      usedInContext,
      cited: false,
      overlapTerms: overlapTerms(opts.query, c.text),
      dropReason: usedInContext ? void 0 : dropReasons.get(c.chunkId),
      ranks: {
        dense: denseRanks.get(c.chunkId) ?? null,
        keyword: keywordRanks.get(c.chunkId) ?? null,
        fused: fusedRanks.get(c.chunkId) ?? null,
        rerank: i + 1
      }
    };
  });
  const denseDiag = {
    queryEmbeddingProduced,
    compatibleStoredVectors: compatible,
    denseCandidatesProduced: dense.length,
    embeddingModelMatch: modelMatch,
    embeddingModelExpected: expectedModel,
    skippedReason
  };
  const resolvedMode = opts.mode === "hybrid" && dense.length ? "hybrid" : dense.length && opts.mode === "dense" ? "dense" : "keyword";
  const corpusId = scope.kind === "all" ? null : scope.corpusId;
  const evidenceGate = {
    ...evidence,
    clearedForInsufficient: evidence.kind === "insufficient" && packed.length > 0
  };
  return {
    chunks: gatedPacked,
    candidates,
    trace: {
      query: opts.query,
      mode: resolvedMode,
      candidateCount: fused.length,
      usedCount: gatedPacked.length,
      candidates,
      dense: denseDiag,
      evidence: evidence.kind,
      evidenceGate,
      storage: opts.storage,
      scoreSemantics: SCORE_SEMANTICS,
      corpusId,
      corpusScope: scope.kind
    },
    denseMs,
    keywordMs,
    rerankMs,
    assembleMs,
    candidateCount: fused.length,
    contextTokens: gatedPacked.reduce((n, c) => n + c.tokenCount, 0),
    evidence: evidence.kind,
    evidenceNote: evidence.note,
    evidenceGate,
    probe: evidence.probe,
    dense: denseDiag,
    actualMode: resolvedMode,
    corpusId,
    corpusScope: scope.kind,
    stages: {
      dense: denseSlugRanks,
      keyword: firstSlugRanks(keyword),
      fused: firstSlugRanks(fused),
      rerank: firstSlugRanks(ranked)
    }
  };
}
var SEPARATORS = ["\n## ", "\n### ", "\n#### ", "\n\n", "\n", ". ", " "];
var CODE_BOUNDARY = {
  typescript: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|type|interface|enum)\s+(\w+)/m,
  tsx: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|type|interface)\s+(\w+)/m,
  javascript: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let)\s+(\w+)/m,
  python: /^(?:async\s+)?(?:def|class)\s+(\w+)/m,
  go: /^(?:func|type)\s+(\w+)/m,
  rust: /^(?:pub\s+)?(?:async\s+)?(?:fn|struct|enum|impl|trait)\s+(\w+)/m,
  java: /^\s*(?:(?:public|private|protected|static|final|abstract|synchronized)\s+)*(?:class|interface|enum|record)\s+(\w+)|^\s*(?:(?:public|private|protected|static|final|abstract|synchronized)\s+)+[\w<>[\]]+\s+(\w+)\s*\(/m,
  c: /^\s*(?!\s*(?:return|if|else|while|for|switch|sizeof)\b)(?:static\s+|inline\s+|extern\s+)*[A-Za-z_][\w* ]*?[*\s]\s*(\w+)\s*\(/m,
  h: /^\s*(?!\s*(?:return|if|else|while|for|switch|sizeof)\b)(?:static\s+|inline\s+|extern\s+)*[A-Za-z_][\w* ]*?[*\s]\s*(\w+)\s*\(/m,
  cpp: /^\s*(?!\s*(?:return|if|else|while|for|switch|sizeof)\b)(?:static\s+|inline\s+|extern\s+)*[A-Za-z_][\w*: ]*?[*\s]\s*(\w+)\s*\(/m,
  cc: /^\s*(?!\s*(?:return|if|else|while|for|switch|sizeof)\b)(?:static\s+|inline\s+|extern\s+)*[A-Za-z_][\w*: ]*?[*\s]\s*(\w+)\s*\(/m,
  hpp: /^\s*(?!\s*(?:return|if|else|while|for|switch|sizeof)\b)(?:static\s+|inline\s+|extern\s+)*[A-Za-z_][\w*: ]*?[*\s]\s*(\w+)\s*\(/m
};
function splitOnce(text, separator) {
  if (!separator) return [text];
  const parts = text.split(separator);
  if (parts.length === 1) return parts;
  const out = [];
  for (let i = 0; i < parts.length; i += 1) {
    const piece = i === 0 ? parts[i] : `${separator}${parts[i]}`;
    if (piece.length) out.push(piece);
  }
  return out;
}
function recursiveSplit(text, seps, targetChars) {
  if (text.length <= targetChars) return [text];
  const [sep, ...rest] = seps;
  if (!sep) {
    const pieces = [];
    for (let i = 0; i < text.length; ) {
      let end = Math.min(i + targetChars, text.length);
      const previous = text.charCodeAt(end - 1);
      const next = text.charCodeAt(end);
      if (previous >= 55296 && previous <= 56319 && next >= 56320 && next <= 57343) end += 1;
      pieces.push(text.slice(i, end));
      i = end;
    }
    return pieces;
  }
  const parts = splitOnce(text, sep);
  const acc = [];
  let buf = "";
  for (const part of parts) {
    if ((buf + part).length <= targetChars) {
      buf += part;
      continue;
    }
    if (buf) acc.push(buf);
    if (part.length > targetChars) {
      acc.push(...recursiveSplit(part, rest, targetChars));
      buf = "";
    } else {
      buf = part;
    }
  }
  if (buf) acc.push(buf);
  return acc;
}
function symbolFrom(text, language) {
  const re = language ? CODE_BOUNDARY[language] : void 0;
  if (re) {
    const m = text.match(re);
    const name = m?.slice(1).find((g) => g);
    if (name) return name;
  }
  const any = text.match(
    /(?:export\s+)?(?:async\s+)?(?:function|class|const|def|fn|func)\s+(\w+)/
  );
  return any?.[1] ?? null;
}
function extractHeader(text) {
  const lines = text.split("\n");
  const header = [];
  let i = 0;
  for (; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (/^(import|from|package|using|#include|export \* from|export \{)/.test(trimmed) || /^\/\/|^#\s|^\/\*/.test(trimmed) || trimmed === "") {
      header.push(line);
      continue;
    }
    break;
  }
  while (header.length && !(header[header.length - 1] ?? "").trim()) header.pop();
  return { header: header.join("\n"), rest: lines.slice(i).join("\n") };
}
function splitCodeUnits(body, language, targetChars) {
  const { header, rest } = extractHeader(body);
  const re = language && CODE_BOUNDARY[language] || CODE_BOUNDARY.typescript;
  const lines = rest.split("\n");
  const units = [];
  let buf = [];
  let bufChars = 0;
  let hasContent = false;
  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) units.push(text);
    buf = [];
    bufChars = 0;
    hasContent = false;
  };
  for (const line of lines) {
    if (re.test(line) && hasContent) flush();
    bufChars += line.length + (buf.length ? 1 : 0);
    hasContent ||= line.trim().length > 0;
    buf.push(line);
    if (bufChars > targetChars * 1.6) {
      const joined = buf.join("\n");
      const parts = recursiveSplit(joined, ["\n\n", "\n"], targetChars);
      units.push(...parts.slice(0, -1));
      const tail = parts[parts.length - 1] ?? "";
      buf = tail.split("\n");
      bufChars = tail.length;
      hasContent = tail.trim().length > 0;
    }
  }
  flush();
  if (!units.length) return header ? [body] : recursiveSplit(body, ["\n\n", "\n"], targetChars);
  return units.map((u, i) => {
    if (!header) return u;
    if (i === 0) return `${header}

${u}`;
    const hint = header.split("\n").slice(0, 12).join("\n");
    return `${hint}

${u}`;
  });
}
function overlapTail(text, count) {
  let start = Math.max(0, text.length - count);
  const first = text.charCodeAt(start);
  const previous = text.charCodeAt(start - 1);
  if (first >= 56320 && first <= 57343 && previous >= 55296 && previous <= 56319) start -= 1;
  return text.slice(start).trim();
}
function chunkProse(body, chunkSize, overlap2, extra) {
  const targetChars = chunkSize * 4;
  const overlapChars = overlap2 * 4;
  const lines = body.split("\n");
  const tableHeadersByRow = /* @__PURE__ */ new Map();
  const separatorRow = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/;
  let fenceRun = null;
  const listIndents = [];
  const tableSpans = [];
  const rowSpanIdx = /* @__PURE__ */ new Map();
  const lineOffsets = [];
  {
    let off = 0;
    for (const l of lines) {
      lineOffsets.push(off);
      off += l.length + 1;
    }
  }
  for (let i = 0; i < lines.length - 2; i += 1) {
    const line = lines[i] ?? "";
    const indentWidth = line.charCodeAt(0) === 32 ? /^ */.exec(line)[0].length : 0;
    if (fenceRun === null && indentWidth < line.length) {
      while (listIndents.length && indentWidth < listIndents[listIndents.length - 1]) listIndents.pop();
      const fc = line.charAt(indentWidth);
      if (fc === "-" || fc === "*" || fc === "+" || fc >= "0" && fc <= "9") {
        const listMarker = /^( *)([-*+]|\d{1,9}[.)])( {1,4}|\t)/.exec(line);
        if (listMarker) {
          const padding = listMarker[3] === "	" ? 4 : listMarker[3].length;
          listIndents.push(indentWidth + listMarker[2].length + padding);
        }
      }
    }
    const firstNonWs = line.charAt(indentWidth);
    const fenceMatch = firstNonWs === "`" || firstNonWs === "~" ? /^(`{3,}|~{3,})/.exec(line.trim()) : null;
    if (fenceMatch) {
      const run = fenceMatch[1];
      const rest = line.trim().slice(run.length);
      if (fenceRun === null) {
        if (run[0] !== "`" || !rest.includes(run)) {
          fenceRun = run;
          continue;
        }
      } else {
        if (run[0] === fenceRun[0] && run.length >= fenceRun.length && !rest.trim()) fenceRun = null;
        continue;
      }
    }
    if (fenceRun !== null) continue;
    const header = line;
    const separator = lines[i + 1] ?? "";
    const activeListIndent = listIndents[listIndents.length - 1];
    if (/^\t/.test(line) || indentWidth >= 4 && (activeListIndent === void 0 || indentWidth > activeListIndent)) continue;
    if (!header.includes("|") || !separatorRow.test(separator.trim())) continue;
    const tableHeader = `${header}
${separator}`;
    let row = i + 2;
    for (; row < lines.length && (lines[row] ?? "").includes("|"); row += 1) {
      const rowText = lines[row] ?? "";
      const trimmedRow = rowText.trim();
      if (/^(#{1,6}\s|>\s?|[-*+]\s|\d{1,9}[.)]\s)/.test(trimmedRow)) break;
      if (trimmedRow.charCodeAt(0) === 96 || trimmedRow.charCodeAt(0) === 126) {
        const fenceStart = /^(`{3,}|~{3,})/.exec(trimmedRow);
        if (fenceStart && (fenceStart[1][0] !== "`" || !trimmedRow.slice(fenceStart[1].length).includes(fenceStart[1])))
          break;
      }
      const rowKey = rowText.trimStart();
      const existing = tableHeadersByRow.get(rowKey);
      if (existing === void 0) tableHeadersByRow.set(rowKey, tableHeader);
      else if (existing !== tableHeader) tableHeadersByRow.set(rowKey, "");
    }
    if (row > i + 2) {
      const lastRow = row - 1;
      const spanIdx = tableSpans.length;
      tableSpans.push([lineOffsets[i], (lineOffsets[lastRow] ?? body.length) + (lines[lastRow] ?? "").length]);
      for (let r = i + 2; r <= lastRow; r += 1) rowSpanIdx.set((lines[r] ?? "").trimStart(), spanIdx);
    }
    i = row - 1;
  }
  const longRows = [...tableHeadersByRow.keys()].filter((row) => row.length > targetChars);
  const rowMatchesFragment = (row, line) => line.length >= 20 ? row.includes(line) : line.length >= 6 && (row.includes(` ${line} `) || row.startsWith(`${line} `) || row.endsWith(` ${line}`));
  const standaloneLines = new Set(body.split("\n"));
  const raw = recursiveSplit(body, SEPARATORS, targetChars);
  const merged = [];
  for (const piece of raw) {
    const last = merged[merged.length - 1];
    if (last && estimateTokens(last) < chunkSize * 0.4 && estimateTokens(last + piece) <= chunkSize * 1.15) {
      merged[merged.length - 1] = `${last}${piece}`;
    } else {
      merged.push(piece);
    }
  }
  const stack = [];
  const paths = merged.map((piece) => {
    const headings = piece.matchAll(/^(#{1,4})\s+(.+)$/gm);
    let label = null;
    for (const m of headings) {
      const level = m[1].length;
      const title = m[2].trim();
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title });
      if (!label) label = stack.map((f) => f.title).join(" > ");
    }
    return label ?? (stack.length ? stack.map((f) => f.title).join(" > ") : null);
  });
  const withOverlap = [];
  for (let i = 0; i < merged.length; i += 1) {
    const prev = merged[i - 1] ?? "";
    const overlapText = overlapTail(prev, overlapChars);
    const text = (overlapText && i > 0 ? `${overlapText}
${merged[i]}` : merged[i]).trim();
    if (text) withOverlap.push(text);
  }
  const pieceStarts = [];
  {
    let off = 0;
    for (const p of merged) {
      pieceStarts.push(off);
      off += p.length;
    }
  }
  const needSpans = tableSpans.length > 0 && longRows.length > 0;
  const withTableHeaders = withOverlap.map((text, pieceIndex) => {
    const pieceStart = pieceStarts[pieceIndex] ?? -1;
    const prev = merged[pieceIndex - 1] ?? "";
    const overlapText = pieceIndex > 0 ? overlapTail(prev, overlapChars) : "";
    const pieceText = merged[pieceIndex] ?? "";
    const analysisText = (overlapText ? `${overlapText}
` : "") + pieceText;
    const lines2 = analysisText.split("\n");
    let lineSpanIdx = null;
    if (needSpans) {
      lineSpanIdx = new Array(lines2.length).fill(null);
      const textStartAbs = pieceStart - (overlapText ? overlapText.length + 1 : 0);
      let cursor = 0;
      for (let li = 0; li < lines2.length; li += 1) {
        const line = lines2[li];
        const at = text.indexOf(line, cursor);
        if (at !== -1) cursor = at + line.length;
        const absStart = textStartAbs + (at === -1 ? 0 : at);
        const idx = tableSpans.findIndex(([s, e]) => absStart >= s && absStart < e);
        lineSpanIdx[li] = idx === -1 ? null : idx;
      }
    }
    const missingHeaders = Array.from(
      new Set(
        lines2.map((line, li) => {
          const rowKey = line.charCodeAt(0) <= 32 && line.length ? line.trimStart() : line;
          const exact = tableHeadersByRow.get(rowKey);
          if (exact !== void 0) return exact;
          const spanIdx = lineSpanIdx ? lineSpanIdx[li] : null;
          if (standaloneLines.has(line) && spanIdx === null) return void 0;
          const candidates = spanIdx === null ? longRows : longRows.filter((row) => rowSpanIdx.get(row) === spanIdx);
          return candidates.find((row) => rowMatchesFragment(row, line)) ? tableHeadersByRow.get(candidates.find((row) => rowMatchesFragment(row, line))) ?? void 0 : void 0;
        }).filter((header) => Boolean(header && !text.includes(header)))
      )
    );
    return missingHeaders.length ? `${missingHeaders.join("\n")}
${text}` : text;
  });
  return withTableHeaders.map((text, ordinal) => ({
    ordinal,
    text,
    tokenCount: estimateTokens(text),
    heading: paths[ordinal] ?? null,
    symbol: extra.symbol,
    filepath: extra.filepath,
    language: extra.language,
    chunkKind: extra.chunkKind
  }));
}
function chunkDocument(body, opts = {}) {
  const normalized = body.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const chunkSize = opts.chunkSize ?? CHUNK_SIZE_TOKENS;
  const overlap2 = opts.overlap ?? CHUNK_OVERLAP_TOKENS;
  const kind = opts.kind ?? "prose";
  const language = opts.language ?? null;
  const filepath = opts.filepath ?? null;
  const extras = { symbol: null, filepath, language, chunkKind: kind };
  if (kind === "code") {
    const targetChars = chunkSize * 4;
    const units = splitCodeUnits(normalized, language, targetChars);
    return units.map((text, ordinal) => ({
      ordinal,
      text,
      tokenCount: estimateTokens(text),
      heading: symbolFrom(text, language),
      symbol: symbolFrom(text, language),
      filepath,
      language,
      chunkKind: "code"
    }));
  }
  return chunkProse(normalized, chunkSize, overlap2, extras);
}
function extractiveAnswer(question, chunks) {
  const terms = new Set(tokenize2(question).filter((t) => !QUERY_STOPWORDS.has(t)));
  const extracts = chunks.slice(0, 3).map((chunk, index) => {
    const paragraphs = chunk.text.split(/\n\s*\n/).map((text2, order) => ({
      text: text2.trim(),
      order,
      score: new Set(tokenize2(text2).filter((t) => terms.has(t))).size
    })).filter((p) => p.text.length > 35 && !p.text.includes("```"));
    const selected = paragraphs.sort((a, b) => b.score - a.score || a.order - b.order).slice(0, 2).sort((a, b) => a.order - b.order);
    const text = (selected.map((p) => p.text).join("\n\n") || chunk.text).replace(/`/g, "").replace(/^#{1,6}\s+/gm, "").trim();
    const clipped = text.length > 700 ? `${text.slice(0, 700).replace(/\s+\S*$/, "")}\u2026` : text;
    return `${clipped}
[Source ${index + 1}]`;
  });
  return "Relevant source excerpts\n\n" + extracts.join("\n\n") + "\n\nThese are retrieved passages, not a generated recommendation. Add a model in Settings to reason across them.";
}
var hash = (s) => createHash("sha256").update(s).digest("hex");
function importBundle(docs) {
  if (!Array.isArray(docs) || !docs.length || docs.length > 10)
    throw Error("Add between 1 and 10 text documents.");
  const scope = "voice-" + randomUUID();
  const sources = docs.map((d) => {
    if (typeof d.title !== "string" || typeof d.text !== "string" || d.text.length < 40 || d.text.length > 6e4 || d.title.length > 160)
      throw Error(
        "Each document needs a title and 40-60,000 characters of text."
      );
    const text = d.text.replace(/\r\n?/g, "\n");
    const memory = parseText({ text, label: d.title });
    if (!memory.ok) throw Error("memoRABLE could not import this document.");
    return {
      id: randomUUID(),
      title: d.title,
      text,
      hash: hash(text),
      memory: memory.value
    };
  });
  const rows = sources.flatMap(
    (s) => chunkDocument(s.text).map((c) => ({
      title: s.title,
      slug: s.id,
      indexedAt: null,
      corpusId: scope,
      chunk: {
        id: randomUUID(),
        document_id: s.id,
        ordinal: c.ordinal,
        text: c.text,
        token_count: c.tokenCount,
        heading: c.heading,
        embedding: null,
        embedding_model: null,
        content_hash: hash(c.text),
        created_at: (/* @__PURE__ */ new Date()).toISOString(),
        filepath: null,
        language: null,
        symbol: null,
        chunk_kind: "prose",
        corpus_id: scope
      }
    }))
  );
  return { scope, sources, rows };
}
function validateEvidence(c, bundle) {
  const source = bundle.sources.find((s) => s.id === c.sourceId);
  if (!source || source.hash !== c.hash || hash(source.text) !== c.hash || !Number.isInteger(c.start) || !Number.isInteger(c.end) || c.start < 0 || c.end <= c.start || c.end > source.text.length || source.text.slice(c.start, c.end) !== c.quote)
    throw Error("Source evidence does not match its original.");
  return true;
}
function answer(question, bundle) {
  if (typeof question !== "string" || !question.trim() || question.length > 4e3)
    throw Error("Ask a question of 1-4,000 characters.");
  const start = performance.now();
  const found = retrieveFromRows({
    query: question,
    queryVector: null,
    mode: "keyword",
    topK: 3,
    embeddingModel: null,
    rows: bundle.rows,
    storage: {
      backend: "ephemeral",
      durable: false,
      denseAvailable: false,
      warning: null
    },
    corpusScope: { kind: "corpus", corpusId: bundle.scope }
  });
  return answerFromRetrieval(
    question,
    bundle,
    found,
    { actualMode: "keyword", embeddingModel: null },
    start
  );
}
function answerFromRetrieval(question, bundle, found, expected, start = performance.now()) {
  if (!found || !Array.isArray(found.chunks) || found.actualMode !== expected.actualMode || !["keyword", "dense", "hybrid"].includes(expected.actualMode) || expected.actualMode !== "keyword" && !expected.embeddingModel)
    throw Error("Retrieval mode contract mismatch.");
  if (!["positive", "negative_not_found", "insufficient", "ambiguous"].includes(
    found.evidence
  ))
    throw Error("Retrieval evidence contract mismatch.");
  if (found.corpusScope !== "corpus" || found.corpusId !== bundle.scope)
    throw Error("Retrieval corpus contract mismatch.");
  for (const chunk of found.chunks) {
    if (chunk.corpusId !== bundle.scope || expected.actualMode !== "keyword" && chunk.embeddingModel !== expected.embeddingModel)
      throw Error("Retrieval corpus/model contract mismatch.");
  }
  const evidence = found.chunks.flatMap((chunk) => {
    const source = bundle.sources.find((s) => s.id === chunk.documentId);
    if (!source) return [];
    const offset = source.text.indexOf(chunk.text);
    if (offset < 0 || source.text.indexOf(chunk.text, offset + 1) !== -1)
      return [];
    const c = {
      sourceId: source.id,
      title: source.title,
      hash: source.hash,
      start: offset,
      end: offset + chunk.text.length,
      firstLine: source.text.slice(0, offset).split("\n").length,
      lastLine: source.text.slice(0, offset + chunk.text.length).split("\n").length,
      quote: chunk.text
    };
    validateEvidence(c, bundle);
    return [c];
  });
  const chunks = found.chunks.filter(
    (c) => evidence.some((e) => e.sourceId === c.documentId && e.quote === c.text)
  );
  const refused = found.evidence !== "positive" || !chunks.length;
  return {
    question,
    context: contextReview(bundle, validateEvidence),
    answer: found.evidence === "ambiguous" ? "Several passages are relevant, but this question remains unresolved. Review the original passages; no supported answer or draft is available." : refused ? "I could not find supporting passages in these documents." : extractiveAnswer(question, chunks).replace(
      " Add a model in Settings to reason across them.",
      ""
    ),
    evidence: refused ? [] : evidence,
    reviewEvidence: found.evidence === "ambiguous" ? evidence : [],
    supported: !refused,
    unresolved: found.evidence === "ambiguous",
    refused,
    evidenceStatus: found.evidence,
    actualMode: found.actualMode,
    embeddingModel: expected.embeddingModel,
    corpusId: bundle.scope,
    generation: false,
    mode: `Local ${found.actualMode} retrieval + source excerpts. No generated synthesis.`,
    latencyMs: Math.round(performance.now() - start)
  };
}
function draft(result, bundle) {
  if (result.refused || !result.evidence.length)
    throw Error("Find supporting evidence before creating a draft.");
  result.evidence.forEach((c) => validateEvidence(c, bundle));
  const review = contextReview(bundle, validateEvidence);
  const refs = /* @__PURE__ */ new Map();
  const quote = (e) => {
    validateEvidence(e, bundle);
    const key = e.sourceId + ":" + e.start;
    if (!refs.has(key)) refs.set(key, refs.size + 1);
    return `"${e.quote}" [${refs.get(key)}: ${e.title}, line ${e.firstLine}]`;
  };
  const section = (name, items) => items.length ? name + "\n" + items.map(quote).join("\n") + "\n\n" : "";
  const body = "Hi,\n\nBefore our next conversation, I would like to align on: " + result.question + "\n\n" + section(
    "Changes mentioned in the record (not independently confirmed as current)",
    review.groups.changes
  ) + section("Open items that need an update", review.groups.open) + section("Conditions that must not be dropped", review.groups.conditions) + section(
    "Decision statements to reconcile (includes proposals and refusals)",
    review.groups.decisions
  ) + (refs.size ? "" : section("Relevant source evidence", result.evidence)) + "Could you confirm which decision statements are current and authoritative, and the owner and next update for each unresolved item? If a later decision superseded one above, please point us to that record.\n\nSuggested next step for review: reconcile any conflicting decision statements and satisfy the recorded conditions before communicating an unconditional commitment.\n\nThanks";
  return {
    subject: "Confirm decisions and open items: " + result.question.slice(0, 90),
    body,
    notice: "Rule-based review draft across all imported documents. May include off-topic signals. Check relevance, chronology, authority and recipients. Nothing sent."
  };
}

// ../voice-adapter.mjs
import { randomBytes } from "node:crypto";
function createVoiceAdapter({
  ttlMs = 12e4,
  now = () => Date.now(),
  retrieval = null,
  bodyTimeoutMs = 5e3
} = {}) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || !Number.isSafeInteger(bodyTimeoutMs) || bodyTimeoutMs < 1 || bodyTimeoutMs > 3e4 || retrieval !== null && (typeof retrieval.retrieve !== "function" || !["keyword", "dense", "hybrid"].includes(retrieval.actualMode) || retrieval.actualMode !== "keyword" && !retrieval.embeddingModel))
    throw Error("Invalid voice adapter config.");
  const grants = /* @__PURE__ */ new Map();
  return {
    bind(bundle) {
      const token = randomBytes(32).toString("hex");
      grants.set(token, {
        bundle,
        expires: now() + ttlMs,
        last: null,
        sequence: 0
      });
      return token;
    },
    revoke(token) {
      grants.delete(token);
    },
    async handle(req) {
      if (req.method !== "POST")
        return Response.json({ error: "Method not allowed" }, { status: 405 });
      const token = req.headers.get("authorization")?.replace(/^Bearer /, "") || "";
      const grant = grants.get(token);
      if (!grant || grant.expires <= now()) {
        grants.delete(token);
        return Response.json(
          { error: "Invalid or expired session capability" },
          { status: 401 }
        );
      }
      const sequence = ++grant.sequence;
      let data;
      try {
        const raw = await boundedBody(req, bodyTimeoutMs);
        data = JSON.parse(raw);
      } catch {
        return Response.json({ error: "Invalid request" }, { status: 400 });
      }
      if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.messages)) {
        return Response.json(
          { error: "Invalid message list" },
          { status: 400 }
        );
      }
      if (grants.get(token) !== grant || grant.expires <= now()) {
        grants.delete(token);
        return Response.json(
          { error: "Invalid or expired session capability" },
          { status: 401 }
        );
      }
      const last = data.messages.at(-1);
      if (data.stream !== true || last?.role !== "user" || typeof last.content !== "string" || !last.content.trim() || last.content.length > 4e3)
        return Response.json(
          {
            error: "A streaming request with a final user message is required"
          },
          { status: 400 }
        );
      if (req.signal.aborted) return new Response(null, { status: 499 });
      let spoken, turn;
      if (/^\s*(turn (that|this|the brief) into (an? )?email|draft (an? )?email)\s*[.!]?\s*$/i.test(
        last.content
      )) {
        if (!grant.last || grant.last.refused)
          spoken = "Ask a question with supporting evidence first. I have not created or sent an email.";
        else {
          const reviewDraft = draft(grant.last, grant.bundle);
          turn = { draft: reviewDraft };
          spoken = "A review draft is ready on screen. Check decisions, conditions and open items before using it. Nothing has been sent.";
        }
      } else {
        const result = retrieval ? answerFromRetrieval(
          last.content,
          grant.bundle,
          await retrieval.retrieve(last.content, grant.bundle, {
            signal: req.signal
          }),
          {
            actualMode: retrieval.actualMode,
            embeddingModel: retrieval.embeddingModel
          }
        ) : answer(last.content, grant.bundle);
        if (!result || typeof result.refused !== "boolean" || !Array.isArray(result.evidence) || !result.refused && !result.evidence.length)
          throw Error("Invalid retrieval result.");
        for (const evidence of result.evidence)
          validateEvidence(evidence, grant.bundle);
        if (req.signal.aborted) return new Response(null, { status: 499 });
        if (grants.get(token) !== grant || grant.expires <= now())
          return Response.json(
            { error: "Invalid or expired session capability" },
            { status: 401 }
          );
        if (sequence !== grant.sequence)
          return Response.json({ error: "Superseded turn" }, { status: 409 });
        grant.last = result;
        turn = { result };
        spoken = grant.last.unresolved ? "Relevant passages need review, but this question is unresolved. No supported answer or draft is available. Review the original passages on screen." : grant.last.refused ? "I could not find supporting evidence in these documents." : `I found ${grant.last.evidence.length} relevant source passages. This local build shows excerpts rather than a synthesized answer. Review the sources on screen, including any conditions or differing decision statements.`;
      }
      const encoder = new TextEncoder(), id = "local-contract-" + randomBytes(8).toString("hex");
      const stream = new ReadableStream({
        start(controller) {
          for (const content of spoken.match(/.{1,64}(?:\s|$)|.{1,64}/g) || []) {
            controller.enqueue(
              encoder.encode(
                "data: " + JSON.stringify({
                  id,
                  object: "chat.completion.chunk",
                  choices: [
                    { index: 0, delta: { content }, finish_reason: null }
                  ]
                }) + "\n\n"
              )
            );
          }
          controller.enqueue(
            encoder.encode(
              "data: " + JSON.stringify({
                id,
                object: "chat.completion.chunk",
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
              }) + "\n\ndata: [DONE]\n\n"
            )
          );
          controller.close();
        }
      });
      grant.turn = turn;
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store"
        }
      });
    },
    lastTurn(token) {
      const g = grants.get(token);
      if (!g || g.expires <= now()) return null;
      return g.turn;
    }
  };
}
async function boundedBody(req, timeoutMs) {
  if (req.signal.aborted) throw Error("Aborted");
  if (!req.body) throw Error("Missing body");
  const reader = req.body.getReader();
  let timer, listener;
  const stopped = new Promise((_, reject) => {
    listener = () => reject(Error("Aborted"));
    req.signal.addEventListener("abort", listener, { once: true });
    timer = setTimeout(() => reject(Error("Body deadline")), timeoutMs);
  });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let raw = "", bytes = 0;
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), stopped]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16e3) throw Error("Body too large");
      raw += decoder.decode(value, { stream: true });
    }
    return raw + decoder.decode();
  } finally {
    clearTimeout(timer);
    req.signal.removeEventListener("abort", listener);
    reader.cancel().catch(() => {
    });
  }
}

// fixtures.mjs
var documents = Object.freeze([
  {
    title: "Fictional - client review",
    text: "# Fictional client review\n\nPilot launch is proposed for Tuesday. Security sign-off is still pending. Maya owns the security review.\n\n## Decisions\n- Budget of INR 50,000 approved by Maya.\n\n## Actions\n- Maya to send security review by Friday."
  },
  {
    title: "Fictional - next meeting",
    text: "# Fictional next meeting\n\nThe pilot launch is not approved. Security sign-off remains pending. Budget approval is unchanged. Next discussion will review security findings."
  }
]);

// ui.mjs
var html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Voice Memory - fictional demo</title><link rel="stylesheet" href="/style.css"></head><body><header>Voice Memory <small>IntelliRAG + memoRABLE</small></header><main><p class="label">FICTIONAL PROJECT ONLY</p><h1>Pick up the conversation<br>with the evidence intact.</h1><p>This protected demo uses two fixed fictional documents. No uploads, email sending, model inference or paid voice calls.</p><section id="login"><h2>Open your demo</h2><form id="signin"><label for="access">Demo access key</label><input id="access" type="password" autocomplete="off" required maxlength="64"><button>Open demo</button></form></section><section id="workspace" hidden><h2>The question</h2><form id="ask"><label for="question">What do you need to remember?</label><textarea id="question" maxlength="4000" required rows="3" placeholder="What is pending for the pilot launch?"></textarea><button>Find the evidence</button></form><p class="note">Keyword retrieval and original excerpts only. No synthesized answer. Microphone and spoken answers are not connected. Each request is independent; voice follow-up drafts are disabled.</p><div id="output"></div><h2>Original sources</h2><div id="sources"></div><button id="logout">Close demo on this browser</button></section><p id="status" role="status" aria-live="polite"></p></main><script type="module" src="/app.js"></script></body></html>`;
var css = `*{box-sizing:border-box}body{margin:0;background:#f6f5f0;color:#202924;font:16px/1.6 system-ui,sans-serif}header{padding:20px 5vw;border-bottom:1px solid #cdd5cc;font-weight:650}small{display:block;font-weight:400;color:#53655c}main{max-width:960px;margin:auto;padding:40px 24px}h1{font-size:clamp(30px,5vw,48px);line-height:1.15;font-weight:550;letter-spacing:-1px}h2{font-size:22px}.label{font-size:12px;letter-spacing:2px;color:#496354}section{background:#fff;padding:24px;border:1px solid #d5dcd5;border-radius:12px;margin:28px 0}label,input,textarea{display:block;width:100%}input,textarea{font:inherit;padding:12px;border:1px solid #a7b5aa;border-radius:6px;margin:8px 0 16px}button{font:inherit;background:#254e3b;color:white;border:0;border-radius:6px;padding:11px 18px;cursor:pointer}button:disabled{opacity:.5}.note{font-size:14px;color:#58665d}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.6 system-ui;border-left:3px solid #a5b6a5;padding-left:14px}#status{overflow-wrap:anywhere}details{margin:16px 0}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #8b9f4e;outline-offset:3px}`;
var js = `const $=s=>document.getElementById(s); let csrf;function status(s){$('status').textContent=s} async function session(){const r=await fetch('/api/session');if(!r.ok)return false;const d=await r.json();csrf=d.csrf;$('login').hidden=true;$('workspace').hidden=false;$('sources').replaceChildren(...d.sources.map(s=>{const x=document.createElement('details'),h=document.createElement('summary'),p=document.createElement('pre');h.textContent=s.title;p.textContent=s.text;x.append(h,p);return x}));status('Fictional sources ready. Session expires after 30 minutes; closing this browser session does not revoke other browsers.');return true} $('signin').onsubmit=async e=>{e.preventDefault();try{const r=await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({access:$('access').value})});$('access').value='';if(!r.ok)throw Error('Access key not accepted.');await session()}catch(e){status(e.message)}};$('ask').onsubmit=async e=>{e.preventDefault();const b=$('ask').querySelector('button');b.disabled=true;try{const r=await fetch('/api/query',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({question:$('question').value})});const d=await r.json();if(!r.ok)throw Error(d.error);const title=document.createElement('h2'),p=document.createElement('p');title.textContent=d.unresolved?'Question unresolved':'Source excerpts';p.textContent=d.answer;$('output').replaceChildren(title,p,...(d.unresolved?d.reviewEvidence:d.evidence).map(c=>{const x=document.createElement('details'),h=document.createElement('summary'),q=document.createElement('pre');h.textContent=c.title+' - lines '+c.firstLine+'-'+c.lastLine;q.textContent=c.quote;x.append(h,q);return x}));status(d.unresolved?'Several passages need review. No supported answer or draft.':'Review the original context before acting.')}catch(e){status(e.message)}finally{b.disabled=false}};$('logout').onclick=async()=>{await fetch('/api/logout',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:'{}'});csrf=null;$('workspace').hidden=true;$('login').hidden=false;$('output').replaceChildren();$('sources').replaceChildren();status('Closed on this browser. Other sessions and the server voice capability are unchanged.')} ;session().catch(()=>status('Demo unavailable.'));`;

// handler.mjs
var sha = (s) => createHash2("sha256").update(s).digest("hex");
var equal = (a, b) => typeof a === "string" && typeof b === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
var corpusHash = sha(JSON.stringify(documents));
function createDemoHandler(env = process.env, now = Date.now) {
  const host = env.VERCEL_URL, keyHash = env.DEMO_ACCESS_SHA256, voiceHash = env.DEMO_VOICE_SHA256, secret = env.DEMO_SESSION_SECRET;
  const end = Date.parse(env.DEMO_EXPIRES_AT || "");
  const configured = env.VERCEL === "1" && env.VERCEL_ENV === "preview" && env.VERCEL_PROJECT_ID === "prj_mrLNCCuV4OrL0uH2h70vzURn8Ozy" && env.VERCEL_GIT_REPO_OWNER === "charan-rathore" && env.VERCEL_GIT_REPO_SLUG === "IntelliRAG" && env.VERCEL_GIT_COMMIT_REF === "demo/bolna-fictional" && /^intellirag-live-own-track-[a-z0-9]{9}-own-track\.vercel\.app$/.test(
    host || ""
  ) && /^[a-f0-9]{64}$/.test(keyHash || "") && /^[a-f0-9]{64}$/.test(voiceHash || "") && /^[A-Za-z0-9]{64}$/.test(secret || "") && Number.isFinite(end);
  const sign = (s) => createHmac("sha256", secret).update(s).digest("hex");
  function seal(p) {
    const s = Buffer.from(JSON.stringify(p)).toString("base64url");
    return s + "." + sign(s);
  }
  function open(token) {
    try {
      const [s, h, ...rest] = token.split(".");
      if (rest.length || !equal(sign(s), h)) return null;
      const p = JSON.parse(Buffer.from(s, "base64url"));
      return p.exp > now() && p.exp <= end && p.corpus === corpusHash && /^[a-f0-9]{64}$/.test(p.csrf) ? p : null;
    } catch {
      return null;
    }
  }
  function response(body2, status = 200, type = "application/json", extra = {}) {
    return new Response(
      typeof body2 === "string" ? body2 : JSON.stringify(body2),
      {
        status,
        headers: {
          "Content-Type": type,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
          "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
          ...extra
        }
      }
    );
  }
  async function body(req, limit = 16e3) {
    if (!req.body) throw Error("Missing body");
    const reader = req.body.getReader();
    let size = 0, parts = [];
    let timer;
    const timeout = new Promise((_, rej) => {
      timer = setTimeout(() => rej(Error("Body deadline")), 5e3);
    });
    try {
      while (true) {
        const p = await Promise.race([reader.read(), timeout]);
        if (p.done) break;
        size += p.value.length;
        if (size > limit) throw Error("Body too large");
        parts.push(p.value);
      }
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts))
      );
    } finally {
      clearTimeout(timer);
      reader.cancel().catch(() => {
      });
    }
  }
  return async function handle2(req) {
    const url = new URL(req.url);
    if (!configured || now() >= end)
      return response({ error: "Demo unavailable" }, 503);
    if (url.protocol !== "https:" || url.host !== host)
      return response({ error: "Wrong host" }, 403);
    if (req.signal.aborted) return response({ error: "Aborted" }, 499);
    if (url.search)
      return response({ error: "Query parameters not accepted" }, 400);
    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      const token = req.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9]{64})$/)?.[1];
      if (!token || !equal(sha(token), voiceHash))
        return response({ error: "Unauthorized" }, 401);
      const adapter = createVoiceAdapter(), innerToken = adapter.bind(importBundle(documents));
      try {
        const result = await adapter.handle(
          new Request(req.url, {
            method: "POST",
            headers: { authorization: "Bearer " + innerToken },
            body: req.body,
            duplex: "half",
            signal: req.signal
          })
        );
        const headers = response("").headers;
        for (const [k, v] of result.headers) headers.set(k, v);
        return new Response(result.body, { status: result.status, headers });
      } finally {
        adapter.revoke(innerToken);
      }
    }
    if (req.method === "POST" && url.pathname === "/login") {
      if (req.headers.get("origin") !== "https://" + host || req.headers.get("content-type") !== "application/json")
        return response({ error: "Invalid origin or content type" }, 403);
      try {
        const data = await body(req, 1024);
        if (!data || Object.keys(data).length !== 1 || typeof data.access !== "string" || !/^[A-Za-z0-9]{64}$/.test(data.access) || !equal(sha(data.access), keyHash))
          return response({ error: "Unauthorized" }, 401);
        const csrf = randomBytes2(32).toString("hex"), exp = Math.min(now() + 18e5, end);
        return response({ csrf, corpusHash }, 200, "application/json", {
          "Set-Cookie": `__Host-vmdemo=${seal({ csrf, exp, corpus: corpusHash })}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor((exp - now()) / 1e3)}`
        });
      } catch {
        return response({ error: "Invalid login" }, 400);
      }
    }
    const cookie = req.headers.get("cookie")?.split("; ").find((s) => s.startsWith("__Host-vmdemo="))?.slice(14), session = cookie && open(cookie);
    if (req.method === "GET" && url.pathname === "/")
      return response(html, 200, "text/html");
    if (req.method === "GET" && url.pathname === "/app.js")
      return response(js, 200, "text/javascript");
    if (req.method === "GET" && url.pathname === "/style.css")
      return response(css, 200, "text/css");
    if (!session) return response({ error: "Sign in required" }, 401);
    if (req.method === "GET" && url.pathname === "/api/session")
      return response({
        csrf: session.csrf,
        corpusHash,
        expiresAt: new Date(session.exp).toISOString(),
        sources: documents.map((d) => ({
          title: d.title,
          hash: sha(d.text),
          text: d.text
        }))
      });
    if (req.method !== "POST" || req.headers.get("origin") !== "https://" + host || !equal(req.headers.get("x-csrf-token"), session.csrf) || req.headers.get("content-type") !== "application/json")
      return response({ error: "Invalid session request" }, 403);
    if (!["/api/query", "/api/logout"].includes(url.pathname))
      return response({ error: "Not found" }, 404);
    if (url.pathname === "/api/logout")
      return response({ cleared: true }, 200, "application/json", {
        "Set-Cookie": "__Host-vmdemo=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
      });
    try {
      const data = await body(req);
      if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length !== 1 || !Object.hasOwn(data, "question"))
        throw Error("Question only");
      const bundle = importBundle(documents), result = answer(data.question, bundle);
      if (req.signal.aborted) return response({ error: "Aborted" }, 499);
      return response(result);
    } catch {
      return response({ error: "Invalid or unsupported question" }, 400);
    }
  };
}
var handler_default = { fetch: createDemoHandler() };

// serve.mjs
var handle = createDemoHandler();
async function serve(req, res) {
  const controller = new AbortController();
  req.once("aborted", () => controller.abort());
  res.once("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers))
      if (v !== void 0) headers.set(k, Array.isArray(v) ? v.join(",") : v);
    const request = new Request(
      "https://" + (req.headers.host || "invalid") + req.url,
      {
        method: req.method,
        headers,
        signal: controller.signal,
        ...!["GET", "HEAD"].includes(req.method) ? { body: Readable.toWeb(req), duplex: "half" } : {}
      }
    );
    const response = await handle(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.write(value))
            await new Promise((resolve) => {
              res.once("drain", resolve);
              res.once("close", resolve);
            });
        }
      } finally {
        await reader.cancel().catch(() => {
        });
      }
    }
    if (!res.destroyed) res.end();
  } catch {
    if (!res.headersSent)
      res.writeHead(500, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      });
    if (!res.destroyed) res.end('{"error":"Demo request failed"}');
  }
}
export {
  serve as default
};
