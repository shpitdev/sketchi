import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

function setup() {
  const t = convexTest(schema, modules);
  return {
    bootstrapAdmin: t.withIdentity({
      subject: "bootstrap-admin",
      email: "bootstrap-admin@example.com",
    }),
    secondBootstrapCandidate: t.withIdentity({
      subject: "second-bootstrap-candidate",
      email: "second-bootstrap@example.com",
    }),
    normalUser: t.withIdentity({
      subject: "normal-user",
      email: "normal@example.com",
    }),
  };
}

afterEach(() => {
  delete process.env.SKETCHI_BOOTSTRAP_ADMIN_EMAILS;
  delete process.env.SKETCHI_BOOTSTRAP_ADMIN_SUBJECTS;
});

describe("users authorization", () => {
  test("bootstraps the first admin from temporary env", async () => {
    const { bootstrapAdmin } = setup();
    process.env.SKETCHI_BOOTSTRAP_ADMIN_EMAILS = "bootstrap-admin@example.com";

    const ensured = await bootstrapAdmin.mutation(api.users.ensure, {});
    const viewer = await bootstrapAdmin.query(api.users.me, {});

    expect(ensured.role).toBe("admin");
    expect(ensured.isAdmin).toBe(true);
    expect(ensured.canManagePublicIconLibraries).toBe(true);
    expect(viewer.user?.role).toBe("admin");
    expect(viewer.identity.isAdmin).toBe(true);
  });

  test("existing Convex admin remains admin after bootstrap env is removed", async () => {
    const { bootstrapAdmin } = setup();
    process.env.SKETCHI_BOOTSTRAP_ADMIN_EMAILS = "bootstrap-admin@example.com";
    await bootstrapAdmin.mutation(api.users.ensure, {});
    delete process.env.SKETCHI_BOOTSTRAP_ADMIN_EMAILS;

    const ensuredAgain = await bootstrapAdmin.mutation(api.users.ensure, {});
    const viewer = await bootstrapAdmin.query(api.users.me, {});

    expect(ensuredAgain.role).toBe("admin");
    expect(viewer.identity.isAdmin).toBe(true);
  });

  test("bootstraps an existing user when no app-owned admin exists", async () => {
    const { bootstrapAdmin } = setup();

    const initial = await bootstrapAdmin.mutation(api.users.ensure, {});
    expect(initial.role).toBe("user");

    process.env.SKETCHI_BOOTSTRAP_ADMIN_EMAILS = "bootstrap-admin@example.com";
    const promoted = await bootstrapAdmin.mutation(api.users.ensure, {});
    const viewer = await bootstrapAdmin.query(api.users.me, {});

    expect(promoted.role).toBe("admin");
    expect(promoted.isAdmin).toBe(true);
    expect(promoted.canManagePublicIconLibraries).toBe(true);
    expect(viewer.user?.role).toBe("admin");
    expect(viewer.identity.isAdmin).toBe(true);
  });

  test("bootstrap env is ignored after an app-owned admin exists", async () => {
    const { bootstrapAdmin, secondBootstrapCandidate } = setup();
    process.env.SKETCHI_BOOTSTRAP_ADMIN_EMAILS =
      "bootstrap-admin@example.com,second-bootstrap@example.com";
    await bootstrapAdmin.mutation(api.users.ensure, {});

    const second = await secondBootstrapCandidate.mutation(
      api.users.ensure,
      {}
    );
    const secondViewer = await secondBootstrapCandidate.query(api.users.me, {});

    expect(second.role).toBe("user");
    expect(secondViewer.identity.isAdmin).toBe(false);
    expect(secondViewer.identity.canManagePublicIconLibraries).toBe(false);
  });

  test("non-admins cannot grant public icon library privileges", async () => {
    const { normalUser, secondBootstrapCandidate } = setup();
    const target = await secondBootstrapCandidate.mutation(
      api.users.ensure,
      {}
    );

    await expect(
      normalUser.mutation(api.users.updateAuthorization, {
        userId: target._id,
        role: "user",
        canManagePublicIconLibraries: true,
      })
    ).rejects.toThrow("Forbidden");
  });

  test("admins cannot demote the final admin", async () => {
    const { bootstrapAdmin } = setup();
    process.env.SKETCHI_BOOTSTRAP_ADMIN_EMAILS = "bootstrap-admin@example.com";
    const admin = await bootstrapAdmin.mutation(api.users.ensure, {});
    delete process.env.SKETCHI_BOOTSTRAP_ADMIN_EMAILS;

    await expect(
      bootstrapAdmin.mutation(api.users.updateAuthorization, {
        userId: admin._id,
        role: "user",
        canManagePublicIconLibraries: false,
      })
    ).rejects.toThrow("Cannot remove the final admin");

    const viewer = await bootstrapAdmin.query(api.users.me, {});
    expect(viewer.user?.role).toBe("admin");
    expect(viewer.identity.isAdmin).toBe(true);
  });

  test("admins can demote another admin when one admin remains", async () => {
    const { bootstrapAdmin, secondBootstrapCandidate } = setup();
    process.env.SKETCHI_BOOTSTRAP_ADMIN_EMAILS = "bootstrap-admin@example.com";
    await bootstrapAdmin.mutation(api.users.ensure, {});
    delete process.env.SKETCHI_BOOTSTRAP_ADMIN_EMAILS;
    const second = await secondBootstrapCandidate.mutation(
      api.users.ensure,
      {}
    );

    await bootstrapAdmin.mutation(api.users.updateAuthorization, {
      userId: second._id,
      role: "admin",
      canManagePublicIconLibraries: true,
    });
    await bootstrapAdmin.mutation(api.users.updateAuthorization, {
      userId: second._id,
      role: "user",
      canManagePublicIconLibraries: false,
    });

    const secondViewer = await secondBootstrapCandidate.query(api.users.me, {});
    const adminViewer = await bootstrapAdmin.query(api.users.me, {});
    expect(secondViewer.user?.role).toBe("user");
    expect(secondViewer.identity.isAdmin).toBe(false);
    expect(adminViewer.identity.isAdmin).toBe(true);
  });
});
