# testsuites + executors

files
- one testsuite per YAML file
- structure: `name`, `description`, `testcases`, `steps`
- testcases run sequentially; steps ordered inside testcase
- default step type = `exec`

step basics
- each step uses an executor
- can add `assertions` list per step
- can add `retry`, `retry_if`, `delay` (seconds) per step

executor list
- amqp
- couchbase
- dbfixtures
- exec (default)
- grpc
- http
- imap
- kafka
- mqtt
- odbc
- ovhapi
- rabbitmq
- readfile
- redis
- smtp
- sql
- ssh
- web

user-defined executors
- define in YAML file, `executor: name`
- stored in `lib/` relative to testsuite
- set dir with `--lib-dir` (recursive scan for `.yml`)
- output vars auto get `json` suffix (`output.foo` => `outputfoojson`)
- templating errors show in `venom.log`; use `indent`/`nindent` for YAML blocks

outputs to next steps
- extract vars with `vars:` per step
- keys: `from`, `regex`, `default`
- reuse via `{{.testcaseName.varName}}`
