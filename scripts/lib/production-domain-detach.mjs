import { productionProjectConfig } from "./production-deploy.mjs";
import { requireWorkerIdentity } from "./worker-apps.mjs";

const cloudflareApiBase = "https://api.cloudflare.com/client/v4";

function requireString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }

  return value.trim();
}

function cloudflareErrors(payload) {
  if (!payload || !Array.isArray(payload.errors)) {
    return "Cloudflare returned an unknown error.";
  }

  return payload.errors
    .map((error) =>
      error && typeof error.message === "string" ? error.message : "unknown",
    )
    .join("; ");
}

export function selectProductionDomainDetachments(identity, domains) {
  const project = productionProjectConfig(identity.projectId);
  requireWorkerIdentity(project.projectId, identity.workerName);
  const expectedHostnames = new Set(project.domainPatterns);

  if (!Array.isArray(domains)) {
    throw new Error("Cloudflare domain list must be an array.");
  }

  return domains
    .filter(
      (domain) =>
        domain &&
        typeof domain.hostname === "string" &&
        expectedHostnames.has(domain.hostname),
    )
    .map((domain) => {
      if (domain.service !== project.workerName) {
        throw new Error(
          `Refusing to detach ${domain.hostname}: project ${project.projectId} expects Worker ${project.workerName}, found ${String(domain.service)}.`,
        );
      }

      return {
        hostname: requireString(domain.hostname, "Cloudflare domain hostname"),
        id: requireString(domain.id, "Cloudflare domain id"),
        service: requireString(domain.service, "Cloudflare Worker service"),
      };
    });
}

export async function detachProductionDomains({
  accountId,
  apiToken,
  projectId,
  workerName,
  apply = false,
  fetchImpl = fetch,
}) {
  const resolvedAccountId = requireString(accountId, "CLOUDFLARE_ACCOUNT_ID");
  const resolvedApiToken = requireString(apiToken, "CLOUDFLARE_API_TOKEN");
  const project = productionProjectConfig(projectId);
  requireWorkerIdentity(project.projectId, workerName);

  if (project.domainPatterns.length === 0) {
    return [];
  }

  const endpoint = `${cloudflareApiBase}/accounts/${resolvedAccountId}/workers/domains`;
  const headers = { Authorization: `Bearer ${resolvedApiToken}` };
  const response = await fetchImpl(endpoint, { headers });
  const payload = await response.json();

  if (
    !response.ok ||
    payload.success !== true ||
    !Array.isArray(payload.result)
  ) {
    throw new Error(
      `Unable to list Worker domains: ${cloudflareErrors(payload)}`,
    );
  }

  const detachments = selectProductionDomainDetachments(
    { projectId: project.projectId, workerName: project.workerName },
    payload.result,
  );

  if (!apply) {
    return detachments;
  }

  for (const domain of detachments) {
    const deleteResponse = await fetchImpl(`${endpoint}/${domain.id}`, {
      headers,
      method: "DELETE",
    });
    const deletePayload = await deleteResponse.json();

    if (!deleteResponse.ok || deletePayload.success !== true) {
      throw new Error(
        `Unable to detach ${domain.hostname}: ${cloudflareErrors(deletePayload)}`,
      );
    }
  }

  return detachments;
}
