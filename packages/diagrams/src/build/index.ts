// Server entrypoint for hosts that run builds: the operations they call and the
// environment, storage and icon services they provide. Schemas alone come from
// `./contract`; agent limits from `./policy`.
export {
	ArtifactStorage,
	ArtifactStorageMemory,
	makeMemoryArtifactStorage,
	makeObjectBucketArtifactStorage,
	type ArtifactStorageShape,
	type ArtifactObjectBucket,
	type ArtifactObjectBucketObject,
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
	BuildIconLoadError,
	makeBuildIconCatalog,
	normalizeIconSlug,
	type BuildCommunityIcons,
	type BuildIconCatalog,
} from "./icons";
export { buildResponse, type BuildRejection } from "./operation";
export {
	BuildRuntimeEnvironment,
	makeBuildRuntimeEnvironmentLayer,
	type ArtifactRenderer,
} from "./runtime";
export { searchIcons } from "./search-icons";
