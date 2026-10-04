"""Builds dataset.json from fixtures and hand-written questions. Fails if any anchor is not an exact (whitespace-normalised) substring of its source."""
import json, hashlib, re, sys, pathlib
root = pathlib.Path(__file__).parent
norm = lambda s: re.sub(r'\s+', ' ', s).strip()
SOURCES = {
 'chalk': dict(file='chalk.md', repo='chalk/chalk', commit='47fc05abd46171b235e24174cd2dba83d25bf037', split='development'),
 'p-retry': dict(file='p-retry.md', repo='sindresorhus/p-retry', commit='1472907affe8d6107aba5884abc36d6361b3042e', split='development'),
 'ky': dict(file='ky.md', repo='sindresorhus/ky', commit='0d59458a0a58e1c3d7c6db0ab17ed5c7cd671e47', split='development'),
 'commander': dict(file='commander.js.md', repo='tj/commander.js', commit='ba6d13ddb4243e5913367734f8c159089ffe7834', split='development'),
 'p-map': dict(file='p-map.md', repo='sindresorhus/p-map', commit='2c0934b8312b637f933b752c6054845c2d2d5533', split='holdout'),
 'uuid': dict(file='uuid.md', repo='uuidjs/uuid', commit='dd8c173521bb3faacb11ff244233df4a0dcde545', split='holdout'),
}
Q = {
'chalk': [
 ("colors-piped","My CLI prints no colors when its output is piped. How can I force colors on?",["use the environment variable `FORCE_COLOR=1` (level 1)"]),
 ("conflict","What happens if I chain two conflicting colors?",["later styles take precedent in case of a conflict"]),
 ("own-instance","How do I turn colors off inside my own library without changing every other package that uses this?",["You should however only do this in your own code as it applies globally to all Chalk consumers.","create a new instance:"]),
 ("stderr","Can I detect color support for the error stream instead of normal output?",["`chalkStderr` contains a separate instance configured with color support detected for `stderr` stream instead of `stdout`."]),
 ("bad-level","Which values are accepted when setting the color level?",["throw for anything that is not an integer from 0 to 3"]),
 ("visible","Which style shows text only when colors are enabled?",["Print the text only when Chalk has a color level above zero."]),
 ("esm","Will this work in my TypeScript project, or is it ESM only?",["Chalk 5 is ESM"]),
 ("validate-names","How can I check if a style name is valid before wrapping the library?",["All supported style strings are exposed as an array of strings for convenience."]),
 ("downsample","What happens to a truecolor value on a terminal that only supports basic colors?",["Colors are downsampled from 16 million RGB values to an ANSI color format that is supported by the terminal emulator"]),
],
'p-retry': [
 ("abort-now","How do I stop retrying immediately for an error that will never succeed, like a 404?",["Abort retrying and reject the promise. No callback functions will be called."]),
 ("typeerror","Why does it stop retrying when my code throws a TypeError?",["Non-network `TypeError`s always abort retries, even if `shouldConsumeRetry` or `shouldRetry` would otherwise allow another attempt."]),
 ("default-retries","How many times does it retry if I set nothing?",["The maximum amount of times to retry the operation. Must be a non-negative integer or `Infinity`.","Default: `10`"]),
 ("rate-limit-free","Can I make rate limit errors not count against my retry budget?",["Decide if this failure should consume a retry from the `retries` budget."]),
 ("callback-order","In what order are the shouldConsumeRetry, onFailedAttempt and shouldRetry callbacks called?",["The function is called _after_ `shouldConsumeRetry` and _before_ `shouldRetry`, for all errors _except_ `AbortError`."]),
 ("sigint","How do I stop retries when the user presses Ctrl+C?",["The package does not handle process signals itself to avoid global side effects."]),
 ("jitter","Is there a way to spread out the retry timings randomly?",["Randomizes the timeouts by multiplying with a factor between 1 and 2."]),
 ("keep-alive","My retry timers keep the Node process from exiting. What option fixes that?",["Prevents retry timeouts from keeping the process alive."]),
 ("wrap","How do I wrap a function once so every call is retried?",["Wrap a function so that each call is automatically retried on failure."]),
 ("args","How do I pass arguments to the function being retried?",["You can pass arguments to the function being retried by wrapping it in an inline arrow function:"]),
],
'ky': [
 ("post-retry","Will a failed POST request get retried automatically?",["`methods`: `get` `put` `head` `delete` `options` `trace` `query`"]),
 ("delay","How long does it wait between retry attempts by default?",["By default, the delay is calculated with `0.3 * (2 ** (attemptCount - 1)) * 1000`."]),
 ("thundering","How can I stop many clients from retrying at the same moment after a rate limit?",["The `jitter` option adds random jitter to retry delays to prevent thundering herd problems."]),
 ("timeout-retry","Why was a request that timed out not retried?",["The `retryOnTimeout` option determines whether to retry when a request times out before a response is returned."]),
 ("total-timeout","Is there a single time limit that covers all the retries together?",["Overall timeout in milliseconds for the entire operation, including retries and delays."]),
 ("per-attempt","What is the default timeout for one attempt?",["Per-attempt timeout in milliseconds for getting a response, applied independently to each retry."]),
 ("max-size","How can I refuse huge response bodies?",["Maximum response body size in bytes."]),
 ("json-header","If I send json and also set my own Content-Type header, which one is used?",["unless you set a `Content-Type` in the `headers` option, which always takes precedence."]),
 ("retry-after","What if the server asks me to wait longer than my allowed maximum?",["If the retry delay from a retry timing header is greater than `maxRetryAfter`, Ky will use `maxRetryAfter`."]),
 ("init-sync","Are errors thrown in the init hook caught by the beforeError hook?",["Unlike other hooks, `init` hooks are synchronous."]),
 ("trailing-slash","Should my base URL path end with a slash?",["we recommend that it include a trailing slash `/`"]),
 ("body-clone","What happens to a streaming request body when retries are enabled?",["Ky clones the request body before each attempt using"]),
],
'commander': [
 ("combine-short","Can I write several short flags together in one argument?",["Multiple boolean short options may be combined following the dash, and may be followed by a single short option taking a value."]),
 ("greedy","Why did my option swallow the next flag as its value?",["Options with an expected option-argument are greedy and will consume the following argument whatever the value."]),
 ("negatable","How do I make a flag that is on by default but can be switched off?",["You can define a boolean option long name with a leading `no-` to set the option value to `false` when used."]),
 ("camel","How do I read an option written as --template-engine in code?",["Multi-word options like `--template-engine` are normalized to camelCase option names"]),
 ("unknown","How do I stop it from erroring on options I did not declare?",["You can suppress the unknown option check with `.allowUnknownOption()`."]),
 ("async","My action handler is async. What do I call instead of parse?",["You may supply an `async` action handler, in which case you call `.parseAsync()` rather than `.parse()`."]),
 ("default-sub","How do I run a subcommand when the user types none?",["Specifying `isDefault: true` will run the subcommand if no other"]),
 ("footer","How do I add a footer to the help of every subcommand?",["`afterAll`: add to the program for a global footer (epilog)"]),
 ("addcommand","A subcommand I attached lost my parent's settings. Why?",["For safety, `.addCommand()` does not automatically copy the inherited settings from the parent command."]),
 ("executables","Where does it look for stand-alone executable subcommands?",["Commander will search the files in the directory of the entry script for a file with the name combination `command-subcommand`"]),
 ("help-stderr","How can I print help to stderr without quitting?",["`.outputHelp()`: output help information without exiting."]),
 ("variadic-stop","When does a variadic option stop reading values?",["are read until the first argument starting with a dash."]),
],
'p-map': [
 ("vs-all","How is this different from Promise.all?",["you can control the concurrency and also decide whether or not to stop iterating when there's an error."]),
 ("order","In what order do the results come back?",["The fulfilled value is an `Array` of the fulfilled values returned from `mapper` in `input` order."]),
 ("collect-errors","How do I keep going after a failure and get every error at the end?",["it will wait for all the promises to settle and then reject with an"]),
 ("error-order","In what order are the errors listed in the aggregate error?",["The errors are listed in the order of the input, not in the order the promises happened to settle in"]),
 ("concurrency","What does the concurrency setting control?",["Number of concurrently pending promises returned by `mapper`."]),
 ("slow-consumer","My consumer is slower than the mapper and I am flooding my database. What limits that?",["Maximum number of promises returned by `mapper` that have resolved but not yet collected by the consumer of the async iterable."]),
 ("skip","How can I leave an item out of the results?",["Return this value from a `mapper` function to skip including the value in the returned array."]),
 ("rate-limit","How do I limit how often calls start, not just how many run at once?",["compose it with a rate limiter like"]),
 ("slow-element","One slow element holds up everything after it in the stream. What can I do?",["A slow element then no longer holds back the results after it"]),
 ("endless","What should I do when my input source never ends?",["Give such a source a finite `concurrency`."]),
 ("after-reject","Do the mappers that already started keep running once one rejects?",["any already-started async mappers will continue to run until they resolve or reject."]),
 ("async-input","Can the input be an async iterable?",["Synchronous or asynchronous iterable that is iterated over concurrently"]),
],
'uuid': [
 ("cjs","Can I still use require() with the latest major version?",["Starting with `uuid@12` CommonJS is no longer supported."]),
 ("sortable","Which function gives me ids that sort by creation time?",["Generate a version 7 (Unix Epoch time-based) UUID"]),
 ("no-v8","Why is there no function for version 8?",["The RFC does not define a creation algorithm for them, which is why this package does not offer a `v8()` method."]),
 ("version-nil","What number does version() give for the all-zero id?",["This method returns `0` for the `NIL` UUID, and `15` for the `MAX` UUID."]),
 ("react-native","I get an error about random values on React Native. How do I fix it?",["Import it _before_ `uuid`."]),
 ("md5","Which function creates the MD5 name-based id?",["Create an RFC version 3 (namespace w/ MD5) UUID"]),
 ("url-namespace","How do I get a stable id derived from a URL?",["The RFC `DNS` and `URL` namespaces are available as `v5.DNS` and `v5.URL`."]),
 ("only-v4","How can I check that a string is a valid v4 only?",["Using `validate` and `version` together it is possible to do per-version validation"]),
 ("options-state","Does passing options change the uniqueness behaviour of timestamp ids?",["With `options`: Internal state is **NOT** used and, instead, appropriate defaults are applied as needed."]),
 ("node-support","Which Node versions are tested?",["plus one prior."]),
 ("too-fast","What error is thrown when ids are generated too quickly?",["`Error` if more than 10M UUIDs/sec are requested"]),
 ("byte-order","How are bytes ordered in the parsed array?",["follows the left &Rarr; right order of hex-pairs in UUID strings"]),
],
}
UNANS = {
 'chalk': ["Does chalk have a Python or Rust port maintained by the same team?","What is the pricing for a chalk enterprise license?"],
 'p-retry': ["How do I configure p-retry to store failed attempts in a Redis queue?","What is the monthly download count of p-retry on PyPI?"],
 'ky': ["Does ky ship a built-in GraphQL client with caching?","What is the SLA for ky security patch releases?"],
 'p-map': ["How do I run p-map mappers inside a Kubernetes cronjob?","Does p-map include a built-in circuit breaker for failing hosts?"],
 'uuid': ["How do I generate ULIDs with this package?","What is the maximum number of UUIDs stored in the built-in database?"],
 'commander': ["How do I deploy a commander program as an AWS Lambda layer?","Which license tier removes the commander telemetry?"],
}
cases=[]; sources={}
for name,meta in SOURCES.items():
    raw=(root/'fixtures'/meta['file']).read_text()
    sources[name]=dict(file='fixtures/'+meta['file'],repo=meta['repo'],commit=meta['commit'],sha256=hashlib.sha256(raw.encode()).hexdigest(),split=meta['split'])
    nraw=norm(raw)
    for cid,q,anchors in Q[name]:
        for a in anchors:
            if norm(a) not in nraw: sys.exit(f'ANCHOR NOT FOUND [{name}/{cid}]: {a}')
        cases.append(dict(id=f'{name}:{cid}',source=name,split=meta['split'],answerable=True,question=q,evidence=[dict(quote=a) for a in anchors]))
    for i,q in enumerate(UNANS[name]):
        cases.append(dict(id=f'{name}:unans{i+1}',source=name,split=meta['split'],answerable=False,question=q,evidence=[]))
json.dump(dict(version='multi-repo-1',sources=sources,cases=cases),open(root/'dataset.json','w'),indent=1)
print(len(cases),'cases ok')
