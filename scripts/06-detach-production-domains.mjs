import { pathToFileURL } from "node:url";

import { detachProductionDomains } from "./lib/production-domain-detach.mjs";
import { productionProjectConfig } from "./lib/production-deploy.mjs";

function readFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    throw new Error(`${name} is required.`);
  }

  const value = args[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${name}.`);
  }

  return value;
}

export async function runProductionDomainDetach(args = process.argv.slice(2)) {
  const project = productionProjectConfig(readFlag(args, "--project"));
  const apply = args.includes("--apply");
  const detachments = await detachProductionDomains({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    projectId: project.projectId,
    workerName: project.workerName,
    apply,
  });

  const action = apply ? "detached" : "would detach";
  if (detachments.length === 0) {
    console.log(
      `No approved domains are attached for project ${project.projectId} and Worker ${project.workerName}.`,
    );
    return detachments;
  }

  for (const domain of detachments) {
    console.log(`${action}: ${domain.hostname} from ${domain.service}`);
  }

  return detachments;
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  runProductionDomainDetach().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
