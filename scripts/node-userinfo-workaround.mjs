import os from "node:os";

try {
  os.userInfo();
} catch {
  // Some constrained Windows runners return UV_ENOMEM for uv_os_get_passwd.
  // tsx only needs a stable, non-secret suffix for its temporary directory.
  os.userInfo = () => ({
    gid: -1,
    homedir: process.env.USERPROFILE || os.tmpdir(),
    shell: null,
    uid: -1,
    username: process.env.USERNAME || "node",
  });
}
