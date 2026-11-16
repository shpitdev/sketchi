// Server entrypoint for hosts that run builds: the operations they call and the
// environment, storage and icon services they provide. Schemas alone come from
// `./contract`; agent limits from `./policy`.
export {
	CodeModeArtifactStorage,
	CodeModeArtifactStorageMemory,
	makeMemoryArtifactStorage,
	makeObjectBucketArtifactStorage,
	type CodeModeArtifactStorageShape,
	type CodeModeObjectBucket,
	type CodeModeObjectBucketObject,
	type StoredArtifactFormat,
} from "./artifacts";
export { observeCodeModeBoundary } from "./boundary";
export { bindBuild, buildFlowchart } from "./builds";
export {
	buildCanonicalDocument,
	canonicalDocumentFromDiagram,
	isCanonicalDocumentType,
} from "./documents";
export { editFlowchart } from "./edit-flowchart";
export {
	CodeModeIconLoadError,
	makeCodeModeIconCatalog,
	normalizeIconSlug,
	type CodeModeCommunityIcons,
	type CodeModeIconCatalog,
} from "./icons";
export { buildResponse, type BuildRejection } from "./operation";
export {
	CodeModeRuntimeEnvironment,
	makeCodeModeRuntimeEnvironmentLayer,
	type CodeModeArtifactRenderer,
} from "./runtime";
export { searchIcons } from "./search-icons";
