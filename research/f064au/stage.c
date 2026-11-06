#define _DARWIN_C_SOURCE

#include <node_api.h>

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdbool.h>
#include <stdio.h>
#include <sys/stat.h>
#include <unistd.h>

static const char source_name[] = "index";
static const char destination_name[] = ".reclaim-pending";

static napi_value receipt(napi_env env, const char *error) {
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

static bool descriptor(napi_env env, napi_value argument, int *fd) {
    double number;
    if (napi_get_value_double(env, argument, &number) != napi_ok ||
        !(number >= 0 && number <= INT_MAX))
        return false;
    *fd = (int)number;
    return (double)*fd == number;
}

static bool same_time(struct timespec left, struct timespec right) {
    return left.tv_sec == right.tv_sec && left.tv_nsec == right.tv_nsec;
}

static bool same_identity(const struct stat *left, const struct stat *right) {
    return left->st_dev == right->st_dev && left->st_ino == right->st_ino &&
        same_time(left->st_birthtimespec, right->st_birthtimespec) &&
        left->st_uid == right->st_uid && left->st_mode == right->st_mode;
}

static bool same_contents_metadata(const struct stat *left, const struct stat *right) {
    return same_identity(left, right) && left->st_nlink == right->st_nlink &&
        left->st_size == right->st_size &&
        same_time(left->st_mtimespec, right->st_mtimespec);
}

static bool same_inventory(const struct stat *left, const struct stat *right) {
    return same_contents_metadata(left, right) &&
        same_time(left->st_ctimespec, right->st_ctimespec);
}

static bool owned_directory(const struct stat *value, uid_t owner, mode_t forbidden) {
    return S_ISDIR(value->st_mode) && value->st_uid == owner &&
        (value->st_mode & forbidden) == 0;
}

static bool source_absent(int profile_fd) {
    struct stat found;
    return fstatat(profile_fd, source_name, &found, AT_SYMLINK_NOFOLLOW) == -1 &&
        errno == ENOENT;
}

static bool unsupported(int error) {
    return error == ENOTSUP || error == EOPNOTSUPP || error == ENOSYS || error == EXDEV;
}

/* The caller owns both descriptors. This probe creates and closes no descriptors. */
static napi_value stage_retired_index(napi_env env, napi_callback_info info) {
    size_t argc = 3;
    napi_value argv[3];
    int profile_fd, index_fd;
    if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok)
        return NULL;
    if (argc != 2 || !descriptor(env, argv[0], &profile_fd) ||
        !descriptor(env, argv[1], &index_fd) || profile_fd == index_fd)
        return receipt(env, "INPUT");

    napi_value success = receipt(env, NULL);
    napi_value collision = receipt(env, "COLLISION");
    napi_value unavailable = receipt(env, "UNSUPPORTED");
    napi_value unknown = receipt(env, "UNKNOWN");
    if (!success || !collision || !unavailable || !unknown) return NULL;

    uid_t owner = geteuid();
    struct stat profile_before, index_before, source_before;
    if (fstat(profile_fd, &profile_before) != 0 || fstat(index_fd, &index_before) != 0 ||
        !owned_directory(&profile_before, owner, 0) || (profile_before.st_mode & 07777) != 0700 ||
        !owned_directory(&index_before, owner, S_IWGRP | S_IWOTH) ||
        profile_before.st_dev != index_before.st_dev || profile_before.st_ino == index_before.st_ino ||
        fstatat(profile_fd, source_name, &source_before, AT_SYMLINK_NOFOLLOW) != 0 ||
        !same_inventory(&index_before, &source_before))
        return receipt(env, "PRECONDITION");

    struct stat existing_destination;
    if (fstatat(profile_fd, destination_name, &existing_destination, AT_SYMLINK_NOFOLLOW) == 0)
        return collision;
    if (errno != ENOENT) return receipt(env, "PRECONDITION");

    if (__builtin_available(macOS 10.12, *)) {
        if (renameatx_np(profile_fd, source_name, profile_fd, destination_name, RENAME_EXCL) != 0) {
            int error = errno;
            if (error == EEXIST) return collision;
            return unsupported(error) ? unavailable : unknown;
        }
    } else {
        return unavailable;
    }

    struct stat profile_after, index_after, destination_after;
    if (fstat(profile_fd, &profile_after) != 0 || !same_identity(&profile_before, &profile_after) ||
        fstat(index_fd, &index_after) != 0 || !same_contents_metadata(&index_before, &index_after) ||
        fstatat(profile_fd, destination_name, &destination_after, AT_SYMLINK_NOFOLLOW) != 0 ||
        !same_inventory(&index_after, &destination_after) || !source_absent(profile_fd))
        return unknown;
    return success;
}

static napi_value initialize(napi_env env, napi_value exports) {
    napi_property_descriptor method = {
        "stageRetiredIndex", NULL, stage_retired_index, NULL, NULL, NULL, napi_default, NULL
    };
    return napi_define_properties(env, exports, 1, &method) == napi_ok ? exports : NULL;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
