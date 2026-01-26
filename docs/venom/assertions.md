# assertions

keywords
- ShouldAlmostEqual
- ShouldAlmostEqualWithDelta
- ShouldBeBetween
- ShouldBeBetweenOrEqual
- ShouldBeBlank
- ShouldBeChronological
- ShouldBeEmpty
- ShouldBeError
- ShouldBeFalse
- ShouldBeGreaterThan
- ShouldBeGreaterThanOrEqualTo
- ShouldBeIn
- ShouldBeLessThan
- ShouldBeLessThanOrEqualTo
- ShouldBeNil
- ShouldBeTrue
- ShouldContain
- ShouldContainKey
- ShouldContainSubstring
- ShouldEqual
- ShouldEqualTrimSpace
- ShouldFail
- ShouldHappenAfter
- ShouldHappenBefore
- ShouldHappenBeforeOrEqual
- ShouldHaveLength
- ShouldHaveSameTypeAs
- ShouldImplement
- ShouldJSONContain
- ShouldJSONContainIgnoreCase
- ShouldJSONEqual
- ShouldJSONEqualIgnoreCase
- ShouldJSONExact
- ShouldJSONExactIgnoreCase
- ShouldJSONGetValue
- ShouldJSONNotContain
- ShouldJSONNotContainIgnoreCase
- ShouldJSONNotEqual
- ShouldJSONNotEqualIgnoreCase
- ShouldNotBeBetween
- ShouldNotBeBetweenOrEqual
- ShouldNotBeBlank
- ShouldNotBeEmpty
- ShouldNotBeError
- ShouldNotBeIn
- ShouldNotBeNil
- ShouldNotContain
- ShouldNotContainKey
- ShouldNotContainSubstring
- ShouldNotEqual
- ShouldNotEqualTrimSpace
- ShouldNotHappenAfter
- ShouldNotHappenBefore
- ShouldNotHappenBeforeOrEqual
- ShouldNotImplement
- ShouldNotResemble
- ShouldNotStartWith
- ShouldNotPanic
- ShouldPanic
- ShouldResemble
- ShouldStartWith
- ShouldTestVersion
- ShouldValidateJson
- ShouldValidateJsonAccordingToRegex
- ShouldValidateJsonPath
- ShouldValidateJsonSchema
- ShouldValidateXML
- ShouldValidateXMLPath
- ShouldValidateXMLSchema

must
- any `ShouldX` => `MustX`

logical operators
- default = AND (implicit)
- explicit `or` and `xor` for groups

user assertions
- create executor named `ShouldYourAssertion`
- context vars: `a` = actual, `b` = expected (arg0), `argv` = args csv
