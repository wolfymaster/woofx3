package services

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/models"
	"github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

// newResourceTestDB extends the in-memory SQLite pattern from
// common_service_test.go with the `resources` table. Hand DDL, same
// reason as the other service tests: the production gorm tags depend on
// Postgres-only uuid_generate_v4(). The CHECK constraints mirror the
// 0032_resources migration (with the kinds 0072 admits) so the tests
// exercise the same guard rails
// production gets.
func newResourceTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := newTestDB(t)
	stmt := `CREATE TABLE resources (
		id TEXT PRIMARY KEY,
		parent_id TEXT NULL REFERENCES resources(id),
		is_folder INTEGER NOT NULL DEFAULT 0,
		name TEXT NOT NULL,
		kind TEXT NOT NULL DEFAULT 'other',
		content_type TEXT NOT NULL DEFAULT '',
		repository_key TEXT NOT NULL DEFAULT '',
		thumbnail_repository_key TEXT NOT NULL DEFAULT '',
		size INTEGER NOT NULL DEFAULT 0,
		status TEXT NOT NULL DEFAULT 'pending',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		CONSTRAINT resources_kind_check
			CHECK (kind IN ('image', 'video', 'audio', 'other', 'folder', 'custom_module')),
		CONSTRAINT resources_status_check
			CHECK (status IN ('pending', 'ready', 'failed')),
		CONSTRAINT resources_folder_has_no_bytes
			CHECK (
				(is_folder = 1 AND repository_key = '' AND thumbnail_repository_key = '')
				OR (is_folder = 0 AND repository_key <> '')
			)
	)`
	if err := db.Exec(stmt).Error; err != nil {
		t.Fatalf("exec ddl: %v", err)
	}
	// Only the columns a resource delete reads to find a module installed
	// from the resource.
	modules := `CREATE TABLE modules (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		upload_resource_id TEXT NULL
	)`
	if err := db.Exec(modules).Error; err != nil {
		t.Fatalf("exec modules ddl: %v", err)
	}
	return db
}

func newResourceSvc(t *testing.T) client.ResourceService {
	t.Helper()
	svc, _ := newResourceSvcWithDB(t)
	return svc
}

func newResourceSvcWithDB(t *testing.T) (client.ResourceService, *gorm.DB) {
	t.Helper()
	db := newResourceTestDB(t)
	return NewResourceService(repository.NewResourceRepository(db)), db
}

func strptr(s string) *string {
	return &s
}

func createUpload(t *testing.T, svc client.ResourceService, name, kind string, parentID *string) *client.Resource {
	t.Helper()
	resp, err := svc.CreateResource(context.Background(), &client.CreateResourceRequest{
		ParentId:      parentID,
		Name:          name,
		Kind:          kind,
		ContentType:   "application/octet-stream",
		RepositoryKey: "user/" + uuid.New().String() + "/" + name,
		Size:          128,
	})
	if err != nil {
		t.Fatalf("CreateResource(%s): %v", name, err)
	}
	return resp.Resource
}

func createFolder(t *testing.T, svc client.ResourceService, name string, parentID *string) *client.Resource {
	t.Helper()
	resp, err := svc.CreateFolder(context.Background(), &client.CreateFolderRequest{
		ParentId: parentID,
		Name:     name,
	})
	if err != nil {
		t.Fatalf("CreateFolder(%s): %v", name, err)
	}
	return resp.Resource
}

func TestCreateResourceDefaultsToPendingAtRoot(t *testing.T) {
	svc := newResourceSvc(t)

	resource := createUpload(t, svc, "clip.mp4", models.ResourceKindVideo, nil)

	if resource.Status != models.ResourceStatusPending {
		t.Fatalf("status = %q, want pending", resource.Status)
	}
	if resource.IsFolder {
		t.Fatal("upload must not be marked as a folder")
	}
	if resource.ParentId != nil {
		t.Fatalf("parent_id = %v, want nil (root)", *resource.ParentId)
	}
	if resource.ThumbnailRepositoryKey != "" {
		t.Fatalf("thumbnail key = %q, want empty on a fresh upload", resource.ThumbnailRepositoryKey)
	}
}

func TestCreateResourceRejectsFolderKind(t *testing.T) {
	svc := newResourceSvc(t)

	_, err := svc.CreateResource(context.Background(), &client.CreateResourceRequest{
		Name:          "not-a-folder",
		Kind:          models.ResourceKindFolder,
		RepositoryKey: "user/x/y/z",
	})
	assertTwirpCode(t, err, twirp.InvalidArgument)
}

func TestCreateResourceRequiresRepositoryKey(t *testing.T) {
	svc := newResourceSvc(t)

	_, err := svc.CreateResource(context.Background(), &client.CreateResourceRequest{
		Name: "orphan.png",
		Kind: models.ResourceKindImage,
	})
	assertTwirpCode(t, err, twirp.InvalidArgument)
}

func TestCreateResourceUsesCallerChosenID(t *testing.T) {
	svc := newResourceSvc(t)
	id := uuid.New().String()
	key := "user/" + id + "/clip.png"

	resp, err := svc.CreateResource(context.Background(), &client.CreateResourceRequest{
		Id:            &id,
		Name:          "clip.png",
		Kind:          models.ResourceKindImage,
		RepositoryKey: key,
	})
	if err != nil {
		t.Fatalf("CreateResource: %v", err)
	}
	if resp.Resource.Id != id {
		t.Fatalf("id = %q, want caller-chosen %q", resp.Resource.Id, id)
	}
	if resp.Resource.RepositoryKey != key {
		t.Fatalf("repository key = %q, want %q", resp.Resource.RepositoryKey, key)
	}

	got, err := svc.GetResource(context.Background(), &client.GetResourceRequest{
		Id: id,
	})
	if err != nil {
		t.Fatalf("GetResource(%s): %v", id, err)
	}
	if got.Resource.RepositoryKey != key {
		t.Fatalf("stored repository key = %q, want %q", got.Resource.RepositoryKey, key)
	}
}

func TestCreateResourceRejectsMalformedID(t *testing.T) {
	svc := newResourceSvc(t)

	for _, id := range []string{"", "not-a-uuid"} {
		_, err := svc.CreateResource(context.Background(), &client.CreateResourceRequest{
			Id:            strptr(id),
			Name:          "clip.png",
			Kind:          models.ResourceKindImage,
			RepositoryKey: "user/x/y/clip.png",
		})
		assertTwirpCode(t, err, twirp.InvalidArgument)
	}
}

func TestSiblingNamesMustBeUniqueWithinAFolder(t *testing.T) {
	svc := newResourceSvc(t)
	folder := createFolder(t, svc, "clips", nil)

	createUpload(t, svc, "a.png", models.ResourceKindImage, &folder.Id)
	_, err := svc.CreateResource(context.Background(), &client.CreateResourceRequest{
		ParentId:      &folder.Id,
		Name:          "A.PNG",
		Kind:          models.ResourceKindImage,
		RepositoryKey: "user/dup/key",
	})
	assertTwirpCode(t, err, twirp.AlreadyExists)

	// The same name under a different parent is fine — uniqueness is
	// per-folder, not global.
	createUpload(t, svc, "a.png", models.ResourceKindImage, nil)
}

func TestCreateResourceRejectsNonFolderParent(t *testing.T) {
	svc := newResourceSvc(t)
	upload := createUpload(t, svc, "photo.png", models.ResourceKindImage, nil)

	_, err := svc.CreateResource(context.Background(), &client.CreateResourceRequest{
		ParentId:      &upload.Id,
		Name:          "nested.png",
		Kind:          models.ResourceKindImage,
		RepositoryKey: "user/nested/key",
	})
	assertTwirpCode(t, err, twirp.InvalidArgument)
}

func TestListResourcesReturnsOnlyDirectChildrenFoldersFirst(t *testing.T) {
	svc := newResourceSvc(t)
	folder := createFolder(t, svc, "b-folder", nil)
	createUpload(t, svc, "a-root.png", models.ResourceKindImage, nil)
	createUpload(t, svc, "child.png", models.ResourceKindImage, &folder.Id)

	root, err := svc.ListResources(context.Background(), &client.ListResourcesRequest{})
	if err != nil {
		t.Fatalf("ListResources(root): %v", err)
	}
	if root.Total != 2 {
		t.Fatalf("root total = %d, want 2 (the nested child must not appear)", root.Total)
	}
	// Folders sort ahead of files regardless of name.
	if !root.Resources[0].IsFolder || root.Resources[0].Name != "b-folder" {
		t.Fatalf("first root entry = %+v, want the folder", root.Resources[0])
	}

	children, err := svc.ListResources(context.Background(), &client.ListResourcesRequest{
		ParentId: &folder.Id,
	})
	if err != nil {
		t.Fatalf("ListResources(folder): %v", err)
	}
	if children.Total != 1 || children.Resources[0].Name != "child.png" {
		t.Fatalf("folder listing = %+v, want just child.png", children.Resources)
	}
}

func TestListResourcesFiltersByKindAndSearch(t *testing.T) {
	svc := newResourceSvc(t)
	createUpload(t, svc, "sunset.png", models.ResourceKindImage, nil)
	createUpload(t, svc, "sunset.mp4", models.ResourceKindVideo, nil)
	createUpload(t, svc, "theme.mp3", models.ResourceKindAudio, nil)

	byKind, err := svc.ListResources(context.Background(), &client.ListResourcesRequest{
		Kind: models.ResourceKindVideo,
	})
	if err != nil {
		t.Fatalf("ListResources(kind): %v", err)
	}
	if byKind.Total != 1 || byKind.Resources[0].Name != "sunset.mp4" {
		t.Fatalf("kind filter returned %+v", byKind.Resources)
	}

	bySearch, err := svc.ListResources(context.Background(), &client.ListResourcesRequest{
		Search: "SUNSET",
	})
	if err != nil {
		t.Fatalf("ListResources(search): %v", err)
	}
	if bySearch.Total != 2 {
		t.Fatalf("case-insensitive search total = %d, want 2", bySearch.Total)
	}
}

func TestListResourcesLeavesModulesOutUnlessAskedFor(t *testing.T) {
	svc := newResourceSvc(t)
	ctx := context.Background()
	createUpload(t, svc, "sunset.png", models.ResourceKindImage, nil)
	createUpload(t, svc, "shoutout.zip", models.ResourceKindCustomModule, nil)

	library, err := svc.ListResources(ctx, &client.ListResourcesRequest{})
	if err != nil {
		t.Fatalf("ListResources: %v", err)
	}
	if library.Total != 1 || library.Resources[0].Name != "sunset.png" {
		t.Fatalf("a listing naming no kind returned %+v, want only sunset.png", library.Resources)
	}

	searched, err := svc.ListResources(ctx, &client.ListResourcesRequest{Search: "shout"})
	if err != nil {
		t.Fatalf("ListResources(search): %v", err)
	}
	if searched.Total != 0 {
		t.Fatalf("a search naming no kind found %d module archives, want 0", searched.Total)
	}

	modules, err := svc.ListResources(ctx, &client.ListResourcesRequest{Kind: models.ResourceKindCustomModule})
	if err != nil {
		t.Fatalf("ListResources(kind custom_module): %v", err)
	}
	if modules.Total != 1 || modules.Resources[0].Name != "shoutout.zip" {
		t.Fatalf("kind custom_module returned %+v, want only shoutout.zip", modules.Resources)
	}
}

func TestListResourcesPaginates(t *testing.T) {
	svc := newResourceSvc(t)
	for _, name := range []string{"a.png", "b.png", "c.png"} {
		createUpload(t, svc, name, models.ResourceKindImage, nil)
	}

	page, err := svc.ListResources(context.Background(), &client.ListResourcesRequest{
		Page:     2,
		PageSize: 2,
	})
	if err != nil {
		t.Fatalf("ListResources(page): %v", err)
	}
	if page.Total != 3 {
		t.Fatalf("total = %d, want the unpaginated 3", page.Total)
	}
	if len(page.Resources) != 1 || page.Resources[0].Name != "c.png" {
		t.Fatalf("page 2 = %+v, want just c.png", page.Resources)
	}
}

func TestUpdateResourceRenamesAndMoves(t *testing.T) {
	svc := newResourceSvc(t)
	folder := createFolder(t, svc, "archive", nil)
	upload := createUpload(t, svc, "old.png", models.ResourceKindImage, nil)

	resp, err := svc.UpdateResource(context.Background(), &client.UpdateResourceRequest{
		Id:       upload.Id,
		Name:     strptr("new.png"),
		ParentId: &folder.Id,
	})
	if err != nil {
		t.Fatalf("UpdateResource: %v", err)
	}
	if resp.Resource.Name != "new.png" {
		t.Fatalf("name = %q, want new.png", resp.Resource.Name)
	}
	if resp.Resource.ParentId == nil || *resp.Resource.ParentId != folder.Id {
		t.Fatalf("parent_id = %v, want %s", resp.Resource.ParentId, folder.Id)
	}

	// Present-but-empty parent_id moves back to the root.
	back, err := svc.UpdateResource(context.Background(), &client.UpdateResourceRequest{
		Id:       upload.Id,
		ParentId: strptr(""),
	})
	if err != nil {
		t.Fatalf("UpdateResource(root): %v", err)
	}
	if back.Resource.ParentId != nil {
		t.Fatalf("parent_id = %v, want nil after move to root", *back.Resource.ParentId)
	}
}

func TestUpdateResourceRejectsMovingAFolderIntoItsOwnSubtree(t *testing.T) {
	svc := newResourceSvc(t)
	outer := createFolder(t, svc, "outer", nil)
	inner := createFolder(t, svc, "inner", &outer.Id)
	deepest := createFolder(t, svc, "deepest", &inner.Id)

	_, err := svc.UpdateResource(context.Background(), &client.UpdateResourceRequest{
		Id:       outer.Id,
		ParentId: &outer.Id,
	})
	assertTwirpCode(t, err, twirp.InvalidArgument)

	_, err = svc.UpdateResource(context.Background(), &client.UpdateResourceRequest{
		Id:       outer.Id,
		ParentId: &deepest.Id,
	})
	assertTwirpCode(t, err, twirp.InvalidArgument)
}

func TestUpdateResourceAttachesThumbnailKey(t *testing.T) {
	svc := newResourceSvc(t)
	upload := createUpload(t, svc, "clip.mp4", models.ResourceKindVideo, nil)
	thumbKey := "user/" + upload.Id + "/thumbnail.jpg"

	resp, err := svc.UpdateResource(context.Background(), &client.UpdateResourceRequest{
		Id:                     upload.Id,
		Status:                 strptr(models.ResourceStatusReady),
		ThumbnailRepositoryKey: &thumbKey,
	})
	if err != nil {
		t.Fatalf("UpdateResource: %v", err)
	}
	if resp.Resource.ThumbnailRepositoryKey != thumbKey {
		t.Fatalf("thumbnail key = %q, want %q", resp.Resource.ThumbnailRepositoryKey, thumbKey)
	}

	// The thumbnail is a column, not a row: listing the root still
	// shows exactly the one upload.
	list, err := svc.ListResources(context.Background(), &client.ListResourcesRequest{})
	if err != nil {
		t.Fatalf("ListResources: %v", err)
	}
	if list.Total != 1 {
		t.Fatalf("total = %d, want 1 — a thumbnail must never be listed as its own resource", list.Total)
	}
}

func TestUpdateResourceRejectsThumbnailOnFolder(t *testing.T) {
	svc := newResourceSvc(t)
	folder := createFolder(t, svc, "photos", nil)

	_, err := svc.UpdateResource(context.Background(), &client.UpdateResourceRequest{
		Id:                     folder.Id,
		ThumbnailRepositoryKey: strptr("user/app/folder/thumbnail.jpg"),
	})
	assertTwirpCode(t, err, twirp.InvalidArgument)
}

func TestDeleteResourceIsRefusedWhileAModuleInstalledFromItIsInstalled(t *testing.T) {
	svc, db := newResourceSvcWithDB(t)
	ctx := context.Background()
	archive := createUpload(t, svc, "shoutout.zip", models.ResourceKindCustomModule, nil)
	folder := createFolder(t, svc, "clips", nil)
	nested := createUpload(t, svc, "nested.zip", models.ResourceKindCustomModule, &folder.Id)
	for _, m := range []struct{ id, name, resourceID string }{
		{"m1", "Shoutout", archive.Id},
		{"m2", "Nested", nested.Id},
	} {
		if err := db.Exec(`INSERT INTO modules (id, name, upload_resource_id) VALUES (?, ?, ?)`,
			m.id, m.name, m.resourceID).Error; err != nil {
			t.Fatalf("insert module: %v", err)
		}
	}

	_, err := svc.DeleteResource(ctx, &client.DeleteResourceRequest{Id: archive.Id})
	assertTwirpCode(t, err, twirp.FailedPrecondition)
	if !strings.Contains(err.Error(), `module "Shoutout"`) || !strings.Contains(err.Error(), "uninstall") {
		t.Fatalf("refusal = %q, want it to name the module and say to uninstall it", err.Error())
	}
	// A folder holding such an archive is refused whole.
	_, err = svc.DeleteResource(ctx, &client.DeleteResourceRequest{Id: folder.Id})
	assertTwirpCode(t, err, twirp.FailedPrecondition)
	if _, err := svc.GetResource(ctx, &client.GetResourceRequest{Id: nested.Id}); err != nil {
		t.Fatalf("the archive in a refused folder delete is gone: %v", err)
	}

	// Uninstalling removes the module row; the archive can then go.
	if err := db.Exec(`DELETE FROM modules WHERE id = 'm1'`).Error; err != nil {
		t.Fatalf("uninstall: %v", err)
	}
	resp, err := svc.DeleteResource(ctx, &client.DeleteResourceRequest{Id: archive.Id})
	if err != nil {
		t.Fatalf("DeleteResource after uninstall: %v", err)
	}
	if len(resp.RepositoryKeys) != 1 {
		t.Fatalf("repository keys = %v, want the archive's one key", resp.RepositoryKeys)
	}
}

func TestDeleteResourceReturnsSubtreeRepositoryKeys(t *testing.T) {
	svc := newResourceSvc(t)
	folder := createFolder(t, svc, "clips", nil)
	nested := createFolder(t, svc, "nested", &folder.Id)
	first := createUpload(t, svc, "one.png", models.ResourceKindImage, &folder.Id)
	second := createUpload(t, svc, "two.png", models.ResourceKindImage, &nested.Id)

	thumbKey := "user/" + second.Id + "/thumbnail.jpg"
	if _, err := svc.UpdateResource(context.Background(), &client.UpdateResourceRequest{
		Id:                     second.Id,
		ThumbnailRepositoryKey: &thumbKey,
	}); err != nil {
		t.Fatalf("attach thumbnail: %v", err)
	}

	resp, err := svc.DeleteResource(context.Background(), &client.DeleteResourceRequest{
		Id: folder.Id,
	})
	if err != nil {
		t.Fatalf("DeleteResource: %v", err)
	}

	got := map[string]bool{}
	for _, key := range resp.RepositoryKeys {
		got[key] = true
	}
	for _, want := range []string{first.RepositoryKey, second.RepositoryKey, thumbKey} {
		if !got[want] {
			t.Fatalf("delete did not return key %q (got %v)", want, resp.RepositoryKeys)
		}
	}

	list, err := svc.ListResources(context.Background(), &client.ListResourcesRequest{})
	if err != nil {
		t.Fatalf("ListResources: %v", err)
	}
	if list.Total != 0 {
		t.Fatalf("total = %d, want 0 after deleting the whole subtree", list.Total)
	}
}

func TestGetResourceUsageCountsEveryFileWhateverItsStatus(t *testing.T) {
	svc := newResourceSvc(t)
	ctx := context.Background()

	empty, err := svc.GetResourceUsage(ctx, &client.GetResourceUsageRequest{})
	if err != nil {
		t.Fatalf("GetResourceUsage on an empty table: %v", err)
	}
	if empty.Bytes != 0 || empty.Files != 0 {
		t.Fatalf("empty usage = %d bytes in %d files, want 0 and 0", empty.Bytes, empty.Files)
	}

	folder := createFolder(t, svc, "clips", nil)
	pending := createUpload(t, svc, "one.png", models.ResourceKindImage, &folder.Id)
	createUpload(t, svc, "two.png", models.ResourceKindImage, nil)
	createUpload(t, svc, "module.zip", models.ResourceKindCustomModule, nil)
	ready := models.ResourceStatusReady
	size := int64(1000)
	if _, err := svc.UpdateResource(ctx, &client.UpdateResourceRequest{
		Id:     pending.Id,
		Status: &ready,
		Size:   &size,
	}); err != nil {
		t.Fatalf("confirm upload: %v", err)
	}

	usage, err := svc.GetResourceUsage(ctx, &client.GetResourceUsageRequest{})
	if err != nil {
		t.Fatalf("GetResourceUsage: %v", err)
	}
	// One ready file of 1000 bytes and two pending files, an image and a
	// module archive, still holding the 128 bytes each was created with;
	// the folder adds nothing.
	if usage.Bytes != 1256 {
		t.Fatalf("bytes = %d, want 1256", usage.Bytes)
	}
	if usage.Files != 3 {
		t.Fatalf("files = %d, want 3", usage.Files)
	}
}
