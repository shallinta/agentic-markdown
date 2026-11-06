// Fixed placement primitive, kept separate from generic save and directory publishing.
static const char reclaim_source_name[] = "index";
static const char reclaim_destination_name[] = ".reclaim-pending";

static napi_value reclaim_receipt(napi_env env, const char *error) {
    napi_value result, value;
    if (napi_create_object(env, &result) != napi_ok ||
        napi_get_boolean(env, error == NULL, &value) != napi_ok ||
        napi_set_named_property(env, result, "ok", value) != napi_ok)
        return NULL;
    if (error != NULL &&
        (napi_create_string_utf8(env, error, NAPI_AUTO_LENGTH, &value) != napi_ok ||
         napi_set_named_property(env, result, "error", value) != napi_ok))
        return NULL;
    return result;
}

static bool reclaim_same_time(struct timespec left, struct timespec right) {
    return left.tv_sec == right.tv_sec && left.tv_nsec == right.tv_nsec;
}

static bool reclaim_same_identity(const struct stat *left, const struct stat *right) {
    return left->st_dev == right->st_dev && left->st_ino == right->st_ino &&
        reclaim_same_time(left->st_birthtimespec, right->st_birthtimespec) &&
        left->st_uid == right->st_uid && left->st_mode == right->st_mode;
}

static bool reclaim_same_contents_metadata(const struct stat *left, const struct stat *right) {
    return reclaim_same_identity(left, right) && left->st_nlink == right->st_nlink &&
        left->st_size == right->st_size &&
        reclaim_same_time(left->st_mtimespec, right->st_mtimespec);
}

static bool reclaim_same_inventory(const struct stat *left, const struct stat *right) {
    return reclaim_same_contents_metadata(left, right) &&
        reclaim_same_time(left->st_ctimespec, right->st_ctimespec);
}

static bool reclaim_owned_directory(const struct stat *value, uid_t owner, mode_t forbidden) {
    return S_ISDIR(value->st_mode) && value->st_uid == owner &&
        (value->st_mode & forbidden) == 0;
}

static bool reclaim_source_absent(int profile_fd) {
    struct stat found;
    return fstatat(profile_fd, reclaim_source_name, &found, AT_SYMLINK_NOFOLLOW) == -1 &&
        errno == ENOENT;
}

static bool reclaim_unsupported(int error) {
    return error == ENOTSUP || error == EOPNOTSUPP || error == ENOSYS || error == EXDEV;
}

/* The caller owns both descriptors. The stage operation creates and closes no descriptors. */
static napi_value stage_retired_index(napi_env env, napi_callback_info info) {
    napi_value argv[2];
    int profile_fd, index_fd;
    if (!args(env, info, argv, 2) || !integer(env, argv[0], &profile_fd) ||
        !integer(env, argv[1], &index_fd) || profile_fd == index_fd)
        return reclaim_receipt(env, "INPUT");

    napi_value success = reclaim_receipt(env, NULL);
    napi_value collision = reclaim_receipt(env, "COLLISION");
    napi_value unavailable = reclaim_receipt(env, "UNSUPPORTED");
    napi_value unknown = reclaim_receipt(env, "UNKNOWN");
    if (!success || !collision || !unavailable || !unknown) return NULL;

    uid_t owner = geteuid();
    struct stat profile_before, index_before, source_before;
    if (fstat(profile_fd, &profile_before) != 0 || fstat(index_fd, &index_before) != 0 ||
        !reclaim_owned_directory(&profile_before, owner, 0) || (profile_before.st_mode & 07777) != 0700 ||
        !reclaim_owned_directory(&index_before, owner, S_IWGRP | S_IWOTH) ||
        profile_before.st_dev != index_before.st_dev || profile_before.st_ino == index_before.st_ino ||
        fstatat(profile_fd, reclaim_source_name, &source_before, AT_SYMLINK_NOFOLLOW) != 0 ||
        !reclaim_same_inventory(&index_before, &source_before))
        return reclaim_receipt(env, "PRECONDITION");

    struct stat existing_destination;
    if (fstatat(profile_fd, reclaim_destination_name, &existing_destination, AT_SYMLINK_NOFOLLOW) == 0)
        return collision;
    if (errno != ENOENT) return reclaim_receipt(env, "PRECONDITION");

    if (__builtin_available(macOS 10.12, *)) {
        if (renameatx_np(profile_fd, reclaim_source_name, profile_fd, reclaim_destination_name, RENAME_EXCL) != 0) {
            int error = errno;
            if (error == EEXIST) return collision;
            return reclaim_unsupported(error) ? unavailable : unknown;
        }
    } else {
        return unavailable;
    }

    struct stat profile_after, index_after, destination_after;
    if (fstat(profile_fd, &profile_after) != 0 || !reclaim_same_identity(&profile_before, &profile_after) ||
        fstat(index_fd, &index_after) != 0 || !reclaim_same_contents_metadata(&index_before, &index_after) ||
        fstatat(profile_fd, reclaim_destination_name, &destination_after, AT_SYMLINK_NOFOLLOW) != 0 ||
        !reclaim_same_inventory(&index_after, &destination_after) || !reclaim_source_absent(profile_fd))
        return unknown;
    return success;
}

static bool known_reclaim_member(const char *leaf) {
    static const char *controls[] = {
        ".managed.json", "bridge.schema", "meta.json", ".tantivy-meta.lock", ".tantivy-writer.lock"
    };
    for (size_t i = 0; i < sizeof(controls) / sizeof(controls[0]); i++)
        if (strcmp(leaf, controls[i]) == 0) return true;
    if (strlen(leaf) <= 33 || leaf[32] != '.') return false;
    for (size_t i = 0; i < 32; i++)
        if (!((leaf[i] >= 'a' && leaf[i] <= 'f') || (leaf[i] >= '0' && leaf[i] <= '9'))) return false;
    const char *extension = leaf + 33;
    static const char *segments[] = { "idx", "pos", "term", "store", "fast", "fieldnorm" };
    for (size_t i = 0; i < sizeof(segments) / sizeof(segments[0]); i++)
        if (strcmp(extension, segments[i]) == 0) return true;
    unsigned long long stamp = 0;
    size_t digits = 0;
    while (extension[digits] >= '0' && extension[digits] <= '9') {
        if (++digits > 16) return false;
        stamp = 10 * stamp + (unsigned long long)(extension[digits - 1] - '0');
    }
    return digits > 0 && (digits == 1 || extension[0] != '0') &&
        stamp <= 9007199254740991ULL && strcmp(extension + digits, ".del") == 0;
}

static bool absent_reclaim_member(int directory_fd, const char *leaf) {
    struct stat found;
    return fstatat(directory_fd, leaf, &found, AT_SYMLINK_NOFOLLOW) == -1 && errno == ENOENT;
}

static bool held_pending_directory(
    int profile_fd, int pending_fd, const struct stat *profile, struct stat *pending
) {
    struct stat root, named;
    return fstat(profile_fd, &root) == 0 && reclaim_same_identity(profile, &root) &&
        fstat(pending_fd, pending) == 0 &&
        reclaim_owned_directory(pending, profile->st_uid, S_IWGRP | S_IWOTH) &&
        pending->st_dev == profile->st_dev && pending->st_ino != profile->st_ino &&
        fstatat(profile_fd, reclaim_destination_name, &named, AT_SYMLINK_NOFOLLOW) == 0 &&
        reclaim_same_inventory(pending, &named) && reclaim_source_absent(profile_fd);
}

/* The caller owns the three descriptors. Only this one proven direct member is removed. */
static napi_value remove_retired_index_member(napi_env env, napi_callback_info info) {
    napi_value argv[4];
    int profile_fd, pending_fd, file_fd;
    char leaf[256];
    if (!args(env, info, argv, 4) || !integer(env, argv[0], &profile_fd) ||
        !integer(env, argv[1], &pending_fd) || !integer(env, argv[2], &file_fd) ||
        profile_fd == pending_fd || profile_fd == file_fd || pending_fd == file_fd ||
        !name(env, argv[3], leaf) || !known_reclaim_member(leaf))
        return reclaim_receipt(env, "INPUT");

    napi_value success = reclaim_receipt(env, NULL);
    napi_value precondition = reclaim_receipt(env, "PRECONDITION");
    napi_value unknown = reclaim_receipt(env, "UNKNOWN");
    if (!success || !precondition || !unknown) return NULL;

    uid_t owner = geteuid();
    struct stat profile, pending, before, named;
    if (fstat(profile_fd, &profile) != 0 || !reclaim_owned_directory(&profile, owner, 0) ||
        (profile.st_mode & 07777) != 0700 ||
        !held_pending_directory(profile_fd, pending_fd, &profile, &pending) ||
        fstat(file_fd, &before) != 0 || !S_ISREG(before.st_mode) || before.st_uid != owner ||
        before.st_dev != pending.st_dev || before.st_nlink != 1 ||
        fstatat(pending_fd, leaf, &named, AT_SYMLINK_NOFOLLOW) != 0 || !reclaim_same_inventory(&before, &named))
        return precondition;
    if (unlinkat(pending_fd, leaf, 0) != 0) return unknown;

    struct stat pending_after, after;
    if (fstat(file_fd, &after) != 0 || !reclaim_same_identity(&before, &after) ||
        after.st_nlink != 0 || after.st_size != before.st_size ||
        !reclaim_same_time(after.st_mtimespec, before.st_mtimespec) ||
        !held_pending_directory(profile_fd, pending_fd, &profile, &pending_after) ||
        !reclaim_same_identity(&pending, &pending_after) || !absent_reclaim_member(pending_fd, leaf))
        return unknown;
    return success;
}

static napi_value remove_empty_retired_index_directory(napi_env env, napi_callback_info info) {
    napi_value argv[2];
    int profile_fd, pending_fd;
    if (!args(env, info, argv, 2) || !integer(env, argv[0], &profile_fd) ||
        !integer(env, argv[1], &pending_fd) || profile_fd == pending_fd)
        return reclaim_receipt(env, "INPUT");

    napi_value success = reclaim_receipt(env, NULL);
    napi_value precondition = reclaim_receipt(env, "PRECONDITION");
    napi_value not_empty = reclaim_receipt(env, "NOT_EMPTY");
    napi_value unknown = reclaim_receipt(env, "UNKNOWN");
    if (!success || !precondition || !not_empty || !unknown) return NULL;

    uid_t owner = geteuid();
    struct stat profile, pending;
    if (fstat(profile_fd, &profile) != 0 || !reclaim_owned_directory(&profile, owner, 0) ||
        (profile.st_mode & 07777) != 0700 ||
        !held_pending_directory(profile_fd, pending_fd, &profile, &pending))
        return precondition;
    if (unlinkat(profile_fd, reclaim_destination_name, AT_REMOVEDIR) != 0)
        return errno == ENOTEMPTY || errno == EEXIST ? not_empty : unknown;

    struct stat profile_after, pending_after;
    if (fstat(profile_fd, &profile_after) != 0 || !reclaim_same_identity(&profile, &profile_after) ||
        fstat(pending_fd, &pending_after) != 0 || !reclaim_same_identity(&pending, &pending_after) ||
        !reclaim_source_absent(profile_fd) || !absent_reclaim_member(profile_fd, reclaim_destination_name))
        return unknown;
    return success;
}

static bool finalizing_record(int profile_fd, const char *leaf, const struct stat *profile, struct stat *value) {
    return fstatat(profile_fd, leaf, value, AT_SYMLINK_NOFOLLOW) == 0 &&
        S_ISREG(value->st_mode) && value->st_uid == profile->st_uid &&
        value->st_dev == profile->st_dev && value->st_nlink == 1 &&
        value->st_size > 0 && (value->st_mode & 077) == 0;
}

/* Fixed selection only. Both descriptors remain owned by the caller. */
static napi_value remove_finalizing_sidecar(napi_env env, napi_callback_info info) {
    napi_value argv[3];
    int profile_fd, file_fd, selector;
    if (!args(env, info, argv, 3) || !integer(env, argv[0], &profile_fd) ||
        !integer(env, argv[1], &file_fd) || !integer(env, argv[2], &selector) ||
        profile_fd == file_fd || selector > 1)
        return reclaim_receipt(env, "INPUT");

    napi_value success = reclaim_receipt(env, NULL);
    napi_value precondition = reclaim_receipt(env, "PRECONDITION");
    napi_value unknown = reclaim_receipt(env, "UNKNOWN");
    if (!success || !precondition || !unknown) return NULL;

    const char *roster = ".reclaim-purge.json";
    const char *completion = ".reclaim-complete.json";
    const char *leaf = selector == 0 ? roster : completion;
    struct stat profile, catalog, companion, before, named;
    if (fstat(profile_fd, &profile) != 0 || !reclaim_owned_directory(&profile, geteuid(), 0) ||
        (profile.st_mode & 07777) != 0700 || !reclaim_source_absent(profile_fd) ||
        !absent_reclaim_member(profile_fd, reclaim_destination_name) ||
        !finalizing_record(profile_fd, "catalog.json", &profile, &catalog) ||
        (selector == 0 ? !finalizing_record(profile_fd, completion, &profile, &companion) :
            !absent_reclaim_member(profile_fd, roster)) ||
        fstat(file_fd, &before) != 0 ||
        !finalizing_record(profile_fd, leaf, &profile, &named) || !reclaim_same_inventory(&before, &named))
        return precondition;
    if (unlinkat(profile_fd, leaf, 0) != 0) return unknown;

    struct stat profile_after, catalog_after, companion_after, after;
    if (fstat(profile_fd, &profile_after) != 0 || !reclaim_same_identity(&profile, &profile_after) ||
        !reclaim_source_absent(profile_fd) || !absent_reclaim_member(profile_fd, reclaim_destination_name) ||
        !finalizing_record(profile_fd, "catalog.json", &profile, &catalog_after) ||
        !reclaim_same_inventory(&catalog, &catalog_after) ||
        (selector == 0 ? (!finalizing_record(profile_fd, completion, &profile, &companion_after) ||
            !reclaim_same_inventory(&companion, &companion_after)) : !absent_reclaim_member(profile_fd, roster)) ||
        fstat(file_fd, &after) != 0 || !reclaim_same_identity(&before, &after) ||
        after.st_nlink != 0 || after.st_size != before.st_size ||
        !reclaim_same_time(after.st_mtimespec, before.st_mtimespec) || !absent_reclaim_member(profile_fd, leaf))
        return unknown;
    return success;
}

static bool finalizing_companions_absent(int profile_fd) {
    return reclaim_source_absent(profile_fd) && absent_reclaim_member(profile_fd, reclaim_destination_name) &&
        absent_reclaim_member(profile_fd, ".reclaim-purge.json") &&
        absent_reclaim_member(profile_fd, ".reclaim-complete.json");
}

/* The caller proves the exact catalog version and profile layout before invoking this fixed unlink. */
static napi_value remove_finalizing_catalog(napi_env env, napi_callback_info info) {
    napi_value argv[2];
    int profile_fd, catalog_fd;
    if (!args(env, info, argv, 2) || !integer(env, argv[0], &profile_fd) ||
        !integer(env, argv[1], &catalog_fd) || profile_fd == catalog_fd)
        return reclaim_receipt(env, "INPUT");

    napi_value success = reclaim_receipt(env, NULL);
    napi_value precondition = reclaim_receipt(env, "PRECONDITION");
    napi_value unknown = reclaim_receipt(env, "UNKNOWN");
    if (!success || !precondition || !unknown) return NULL;

    const char *leaf = "catalog.json";
    struct stat profile, before, named;
    if (fstat(profile_fd, &profile) != 0 || !reclaim_owned_directory(&profile, geteuid(), 0) ||
        (profile.st_mode & 07777) != 0700 || !finalizing_companions_absent(profile_fd) ||
        fstat(catalog_fd, &before) != 0 ||
        !finalizing_record(profile_fd, leaf, &profile, &named) || !reclaim_same_inventory(&before, &named))
        return precondition;
    if (unlinkat(profile_fd, leaf, 0) != 0) return unknown;

    struct stat profile_after, after;
    if (fstat(profile_fd, &profile_after) != 0 || !reclaim_same_identity(&profile, &profile_after) ||
        !finalizing_companions_absent(profile_fd) || fstat(catalog_fd, &after) != 0 ||
        !reclaim_same_identity(&before, &after) || after.st_nlink != 0 ||
        after.st_size != before.st_size || !reclaim_same_time(after.st_mtimespec, before.st_mtimespec) ||
        !absent_reclaim_member(profile_fd, leaf))
        return unknown;
    return success;
}
