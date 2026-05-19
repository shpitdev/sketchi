import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const baseStyleSettings = {
  strokeColor: "#000000",
  backgroundColor: "transparent",
  strokeWidth: 2,
  strokeStyle: "solid" as const,
  fillStyle: "hachure" as const,
  opacity: 100,
};

function setup() {
  const t = convexTest(schema, modules);
  return {
    t,
    authed: t.withIdentity({
      subject: "test-user-icon-libraries",
      email: "icon-libraries@example.com",
    }),
    bootstrapAdmin: t.withIdentity({
      subject: "bootstrap-admin",
      email: "bootstrap-admin@example.com",
    }),
    publicLibraryEditor: t.withIdentity({
      subject: "public-library-editor",
      email: "public-library-editor@example.com",
    }),
    otherAuthed: t.withIdentity({
      subject: "different-user-icon-libraries",
      email: "different-icon-libraries@example.com",
    }),
  };
}

async function bootstrapAdminUser(
  adminClient: ReturnType<typeof setup>["bootstrapAdmin"]
) {
  process.env.SKETCHI_BOOTSTRAP_ADMIN_EMAILS = "bootstrap-admin@example.com";
  const admin = await adminClient.mutation(api.users.ensure, {});
  delete process.env.SKETCHI_BOOTSTRAP_ADMIN_EMAILS;
  return admin;
}

async function grantPublicIconLibraryEditor(args: {
  adminClient: ReturnType<typeof setup>["bootstrapAdmin"];
  targetClient: ReturnType<typeof setup>["publicLibraryEditor"];
}) {
  await bootstrapAdminUser(args.adminClient);
  const target = await args.targetClient.mutation(api.users.ensure, {});
  await args.adminClient.mutation(api.users.updateAuthorization, {
    userId: target._id,
    role: "user",
    canManagePublicIconLibraries: true,
  });
  return target;
}

afterEach(() => {
  delete process.env.SKETCHI_BOOTSTRAP_ADMIN_EMAILS;
  delete process.env.SKETCHI_BOOTSTRAP_ADMIN_SUBJECTS;
});

describe("iconLibraries", () => {
  test("create defaults roughness to 0.4", async () => {
    const { authed } = setup();
    const id = await authed.mutation(api.iconLibraries.create, {
      name: "Test Lib",
    });
    const data = await authed.query(api.iconLibraries.get, { id });
    expect(data).not.toBeNull();
    if (!data) {
      throw new Error("expected icon library data");
    }

    expect(data.library.styleSettings.roughness).toBeCloseTo(0.4, 5);
  });

  test("update clamps roughness to <= 2", async () => {
    const { authed } = setup();
    const id = await authed.mutation(api.iconLibraries.create, {
      name: "Clamp Lib",
    });
    await authed.mutation(api.iconLibraries.update, {
      id,
      styleSettings: { ...baseStyleSettings, roughness: 5 },
    });

    const data = await authed.query(api.iconLibraries.get, { id });
    expect(data).not.toBeNull();
    if (!data) {
      throw new Error("expected icon library data");
    }
    expect(data.library.styleSettings.roughness).toBe(2);
  });

  test("update clamps roughness to >= 0", async () => {
    const { authed } = setup();
    const id = await authed.mutation(api.iconLibraries.create, {
      name: "Clamp Lib 2",
    });
    await authed.mutation(api.iconLibraries.update, {
      id,
      styleSettings: { ...baseStyleSettings, roughness: -1 },
    });

    const data = await authed.query(api.iconLibraries.get, { id });
    expect(data).not.toBeNull();
    if (!data) {
      throw new Error("expected icon library data");
    }
    expect(data.library.styleSettings.roughness).toBe(0);
  });

  test("non-editor users cannot create public libraries", async () => {
    const { authed } = setup();
    await expect(
      authed.mutation(api.iconLibraries.create, {
        name: "Public Lib",
        visibility: "public",
      })
    ).rejects.toThrow("Forbidden");
  });

  test("public icon editors can create and edit public libraries without full admin", async () => {
    const { bootstrapAdmin, publicLibraryEditor } = setup();
    await grantPublicIconLibraryEditor({
      adminClient: bootstrapAdmin,
      targetClient: publicLibraryEditor,
    });

    const viewer = await publicLibraryEditor.query(api.users.me, {});
    expect(viewer.identity.isAdmin).toBe(false);
    expect(viewer.identity.canManagePublicIconLibraries).toBe(true);

    const id = await publicLibraryEditor.mutation(api.iconLibraries.create, {
      name: "Public Lib",
      visibility: "public",
    });

    const editorView = await publicLibraryEditor.query(api.iconLibraries.get, {
      id,
    });
    expect(editorView).not.toBeNull();
    if (!editorView) {
      throw new Error("expected public library data");
    }

    expect(editorView.permissions.canEdit).toBe(true);
    expect(editorView.permissions.isPublic).toBe(true);

    await publicLibraryEditor.mutation(api.iconLibraries.update, {
      id,
      name: "Public Lib Updated",
      visibility: "public",
      styleSettings: { ...baseStyleSettings, roughness: 1.2 },
    });

    const updated = await publicLibraryEditor.query(api.iconLibraries.get, {
      id,
    });
    expect(updated?.library.name).toBe("Public Lib Updated");
    expect(updated?.permissions.canEdit).toBe(true);
  });

  test("admins can create and edit public libraries", async () => {
    const { bootstrapAdmin } = setup();
    await bootstrapAdminUser(bootstrapAdmin);

    const viewer = await bootstrapAdmin.query(api.users.me, {});
    expect(viewer.identity.isAdmin).toBe(true);
    expect(viewer.identity.canManagePublicIconLibraries).toBe(true);

    const id = await bootstrapAdmin.mutation(api.iconLibraries.create, {
      name: "Admin Public Lib",
      visibility: "public",
    });
    await bootstrapAdmin.mutation(api.iconLibraries.update, {
      id,
      name: "Admin Public Lib Updated",
      visibility: "public",
    });

    const updated = await bootstrapAdmin.query(api.iconLibraries.get, { id });
    expect(updated?.permissions.canEdit).toBe(true);
    expect(updated?.library.name).toBe("Admin Public Lib Updated");
  });

  test("public libraries remain read-only for signed-in users without Convex privileges", async () => {
    const { bootstrapAdmin, publicLibraryEditor, otherAuthed } = setup();
    await grantPublicIconLibraryEditor({
      adminClient: bootstrapAdmin,
      targetClient: publicLibraryEditor,
    });

    const id = await publicLibraryEditor.mutation(api.iconLibraries.create, {
      name: "Readonly Public Lib",
      visibility: "public",
    });

    const viewerData = await otherAuthed.query(api.iconLibraries.get, { id });
    expect(viewerData).not.toBeNull();
    if (!viewerData) {
      throw new Error("expected public library data");
    }

    expect(viewerData.permissions.canEdit).toBe(false);
    await expect(
      otherAuthed.mutation(api.iconLibraries.update, {
        id,
        name: "Should Fail",
      })
    ).rejects.toThrow("Forbidden");
  });

  test("public editor email without a Convex grant cannot edit public libraries", async () => {
    const { bootstrapAdmin, publicLibraryEditor } = setup();
    await bootstrapAdminUser(bootstrapAdmin);

    const id = await bootstrapAdmin.mutation(api.iconLibraries.create, {
      name: "Seed Public Lib",
      visibility: "public",
    });

    const viewer = await publicLibraryEditor.query(api.iconLibraries.get, {
      id,
    });
    expect(viewer).not.toBeNull();
    if (!viewer) {
      throw new Error("expected public library data");
    }

    expect(viewer.permissions.canEdit).toBe(false);
    expect(viewer.permissions.isPublic).toBe(true);
  });

  test("unauthenticated users remain blocked from protected actions", async () => {
    const { t } = setup();
    await expect(
      t.mutation(api.iconLibraries.create, {
        name: "Anonymous Private Lib",
        visibility: "private",
      })
    ).rejects.toThrow("Unauthorized");
  });
});
