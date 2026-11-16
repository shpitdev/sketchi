// Server entrypoint for hosts that run builds: the operations they call and the
// environment, storage and icon services they provide. Schemas alone come from
// `./contract.js`; agent limits from `./policy.js`.
export {
	CodeModeArtifactStorage,
	CodeModeArtifactStorageMemory,
	makeMemoryArtifactStorage,
	makeObjectBucketArtifactStorage,
	type CodeModeArtifactStorageShape,
	type CodeModeObjectBucket,
	type CodeModeObjectBucketObject,
	type StoredArtifactFormat,
} from "./artifacts.js";
export { observeCodeModeBoundary } from "./boundary.js";
export { bindBuild, buildFlowchart } from "./builds.js";
export {
	buildCanonicalDocument,
	canonicalDocumentFromDiagram,
	isCanonicalDocumentType,
} from "./documents.js";
export { editFlowchart } from "./edit-flowchart.js";
export {
	CodeModeIconLoadError,
	makeCodeModeIconCatalog,
	normalizeIconSlug,
	type CodeModeCommunityIcons,
	type CodeModeIconCatalog,
} from "./icons.js";
export { buildResponse, type BuildRejection } from "./operation.js";
export {
	CodeModeRuntimeEnvironment,
	makeCodeModeRuntimeEnvironmentLayer,
	type CodeModeArtifactRenderer,
} from "./runtime.js";
export { searchIcons } from "./search-icons.js";
