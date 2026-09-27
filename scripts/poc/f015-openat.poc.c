// NON-PRODUCT PoC: fixed arity protects Darwin arm64 variadic calling convention.
extern int openat(int fd, const char *path, int flags, ...);
int safe_openat(int fd, const char *path, int flags, unsigned int mode) {
  return openat(fd, path, flags, mode);
}
