"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  readLibraryFile,
  readLibraryFileAsync,
  scanAnimations,
  scanAvatars,
  scanEnvironments,
} = require("./user-library.cjs");

/**
 * @param {import("node:test").TestContext} context
 * @param {Record<string, string>} files name → contents ("/" nests a subfolder)
 */
function fixture(context, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "avatar-library-"));
  context.after(() => fs.rmSync(root, { force: true, recursive: true }));
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  return root;
}

test("scans .vrma files into sorted, labelled entries", (context) => {
  const root = fixture(context, {
    "victory_pose.vrma": "b",
    "my-wave.vrma": "a",
    "notes.txt": "ignored",
  });

  const scanned = scanAnimations(root);

  assert.deepEqual(
    scanned.map((entry) => [entry.label, entry.fileName]),
    [
      ["my wave", "my-wave.vrma"],
      ["victory pose", "victory_pose.vrma"],
    ],
  );
});

// .vrm and .vrma differ by one character, so a prefix or `includes` check would
// leak whole avatars into the animations menu (and vice versa).
test("keeps .vrm and .vrma in their own scans", (context) => {
  const root = fixture(context, {
    "model.vrm": "avatar",
    "clip.vrma": "animation",
    "SHOUT.VRMA": "animation",
  });

  assert.deepEqual(
    scanAnimations(root).map((entry) => entry.fileName).sort(),
    ["SHOUT.VRMA", "clip.vrma"],
  );
  assert.deepEqual(
    scanAvatars(root).map((entry) => entry.fileName),
    ["model.vrm"],
  );
  assert.deepEqual(scanEnvironments(root), []);
});

// Animations are the one kind scanned recursively: a library keeps its static
// poses in `poses/` so they do not clutter one flat list with the full clips.
test("scans animation subfolders, carrying the folder name as the group", (context) => {
  const root = fixture(context, {
    "top.vrma": "a",
    "poses/pose-01.vrma": "b",
    "poses/pose-02.vrma": "c",
  });

  assert.deepEqual(
    scanAnimations(root).map((entry) => [entry.fileName, entry.group]),
    [
      // Ungrouped root clips sort first, then each subfolder's.
      ["top.vrma", null],
      ["pose-01.vrma", "poses"],
      ["pose-02.vrma", "poses"],
    ],
  );
});

test("a folder nested deeper keeps its top-level group, so the menu stays two levels", (context) => {
  const root = fixture(context, {
    "poses/sitting/deep.vrma": "a",
  });

  assert.deepEqual(
    scanAnimations(root).map((entry) => entry.group),
    ["poses"],
  );
});

// Avatars and environments are picked one at a time, so a nested folder there
// is likelier to be a stray backup than a deliberate grouping.
test("avatars and environments still scan the top level only", (context) => {
  const root = fixture(context, {
    "top.vrm": "a",
    "pack/nested.vrm": "b",
    "shot.png": "c",
    "pack/nested.png": "d",
  });

  assert.deepEqual(
    scanAvatars(root).map((entry) => entry.fileName),
    ["top.vrm"],
  );
  assert.deepEqual(
    scanEnvironments(root).map((entry) => entry.fileName),
    ["shot.png"],
  );
});

test("returns nothing for an empty, missing, or non-directory path", (context) => {
  const root = fixture(context, { "only.txt": "x" });

  assert.deepEqual(scanAnimations(root), []);
  assert.deepEqual(scanAnimations(path.join(root, "does-not-exist")), []);
  assert.deepEqual(scanAnimations(path.join(root, "only.txt")), []);
  assert.deepEqual(scanAnimations(""), []);
  assert.deepEqual(scanAnimations(null), []);
});

test("ids are stable per path and read back the right bytes", (context) => {
  const root = fixture(context, { "clip.vrma": "animation-bytes" });

  const [first] = scanAnimations(root);
  const [second] = scanAnimations(root);

  // The renderer persists this id as `animationId`, so a rescan has to hand back
  // the same one or every restart loses the user's selection.
  assert.equal(first.id, second.id);
  assert.match(first.id, /^lib-anim-clip-[0-9a-f]{12}$/);
  assert.equal(readLibraryFile(first.id).toString(), "animation-bytes");
});

// The renderer reads each scanned clip individually and skips the ones that
// fail, so the read has to reject per file rather than return something empty.
test("reading a clip that vanished after the scan throws", (context) => {
  const root = fixture(context, { "gone.vrma": "bytes" });
  const [entry] = scanAnimations(root);

  fs.rmSync(path.join(root, "gone.vrma"));

  assert.throws(() => readLibraryFile(entry.id));
  assert.throws(() => readLibraryFile("lib-anim-never-scanned-000000000000"));
});

// The IPC channel reads asynchronously so a large environment image cannot
// block the main process, and with it the window. Same contract as the sync
// read, or the renderer's error handling would only hold for one of them.
test("the async read matches the sync one, including its failures", async (context) => {
  const root = fixture(context, { "clip.vrma": "animation-bytes" });
  const [entry] = scanAnimations(root);

  assert.equal((await readLibraryFileAsync(entry.id)).toString(), "animation-bytes");

  fs.rmSync(path.join(root, "clip.vrma"));

  await assert.rejects(() => readLibraryFileAsync(entry.id));
  await assert.rejects(() => readLibraryFileAsync("lib-anim-never-scanned-000000000000"));
});
