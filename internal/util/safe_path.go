package util

import (
	"path/filepath"
	"strings"

	"github.com/pkg/errors"
)

// SafeJoinUnderBase joins a relative storage path under baseDir and rejects escapes.
func SafeJoinUnderBase(baseDir, relativePath string) (string, error) {
	if baseDir == "" {
		return "", errors.New("base directory is empty")
	}
	if relativePath == "" {
		return "", errors.New("relative path is empty")
	}
	if filepath.IsAbs(relativePath) {
		return "", errors.Errorf("absolute path is not allowed: %s", relativePath)
	}

	cleanRelativePath := filepath.Clean(filepath.FromSlash(relativePath))
	if cleanRelativePath == "." || !filepath.IsLocal(cleanRelativePath) {
		return "", errors.Errorf("unsafe relative path: %s", relativePath)
	}

	baseAbs, err := filepath.Abs(baseDir)
	if err != nil {
		return "", errors.Wrap(err, "failed to resolve base directory")
	}
	joinedPath := filepath.Join(baseAbs, cleanRelativePath)
	if !pathIsLexicallyUnderBase(baseAbs, joinedPath) {
		return "", errors.Errorf("path escapes base directory: %s", relativePath)
	}
	return joinedPath, nil
}

// EnsurePathWithinBase resolves symlinks and rejects paths outside baseDir.
func EnsurePathWithinBase(baseDir, path string) error {
	baseAbs, err := filepath.Abs(baseDir)
	if err != nil {
		return errors.Wrap(err, "failed to resolve base directory")
	}
	resolvedBase, err := filepath.EvalSymlinks(baseAbs)
	if err != nil {
		return errors.Wrap(err, "failed to resolve base directory symlinks")
	}
	resolvedPath, err := filepath.EvalSymlinks(path)
	if err != nil {
		return errors.Wrap(err, "failed to resolve path symlinks")
	}
	if !pathIsLexicallyUnderBase(resolvedBase, resolvedPath) {
		return errors.Errorf("path escapes base directory: %s", path)
	}
	return nil
}

// EnsureParentWithinBase resolves the parent directory and rejects symlink escapes.
func EnsureParentWithinBase(baseDir, path string) error {
	baseAbs, err := filepath.Abs(baseDir)
	if err != nil {
		return errors.Wrap(err, "failed to resolve base directory")
	}
	resolvedBase, err := filepath.EvalSymlinks(baseAbs)
	if err != nil {
		return errors.Wrap(err, "failed to resolve base directory symlinks")
	}
	resolvedParent, err := filepath.EvalSymlinks(filepath.Dir(path))
	if err != nil {
		return errors.Wrap(err, "failed to resolve parent directory symlinks")
	}
	if !pathIsLexicallyUnderBase(resolvedBase, resolvedParent) {
		return errors.Errorf("path parent escapes base directory: %s", path)
	}
	return nil
}

func pathIsLexicallyUnderBase(baseDir, path string) bool {
	rel, err := filepath.Rel(baseDir, path)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}
