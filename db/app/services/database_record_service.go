package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/common/cloudevents"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

const maxDatabaseInsertKeyLength = 255

// databaseRecordOp is what happened to a record, in the
// `database.record.changed` event.
type databaseRecordOp string

const (
	databaseRecordCreated databaseRecordOp = "created"
	databaseRecordUpdated databaseRecordOp = "updated"
	databaseRecordDeleted databaseRecordOp = "deleted"
)

// databaseRecordChangedEvent is the data of `database.record.changed`. Must
// match DatabaseRecordChangedData in shared/clients/typescript/api/webhooks.ts.
// It carries only public columns: the event leaves the engine toward the
// public user page.
type databaseRecordChangedEvent struct {
	DatabaseID string           `json:"databaseId"`
	RecordID   string           `json:"recordId"`
	Op         databaseRecordOp `json:"op"`
	Revision   int64            `json:"revision"`
	CreatedAt  string           `json:"createdAt"`
	// PublicValues is null for a deleted record.
	PublicValues map[string]any `json:"publicValues"`
}

// DatabaseRecordService implements `client.DatabaseRecordService`.
//
// Nothing here logs a value: cells can hold viewer-written text and viewer
// identity, so only ids reach a log or an error.
type DatabaseRecordService struct {
	modules   *repo.ModuleRepository
	instances *repo.ModuleResourceInstanceRepository
	records   *repo.DatabaseRecordRepository
	publisher *workers.EventPublisher
	limits    DatabaseLimits
}

func NewDatabaseRecordService(
	modules *repo.ModuleRepository,
	instances *repo.ModuleResourceInstanceRepository,
	records *repo.DatabaseRecordRepository,
	publisher *workers.EventPublisher,
	limits DatabaseLimits,
) (*DatabaseRecordService, error) {
	if modules == nil || instances == nil || records == nil || publisher == nil {
		return nil, errors.New("database record service: a dependency is nil")
	}
	return &DatabaseRecordService{modules: modules, instances: instances, records: records, publisher: publisher, limits: limits}, nil
}

// databaseTarget is a resolved database: its instance, canonical id and
// current columns.
type databaseTarget struct {
	instance    *models.ModuleResourceInstance
	canonicalID string
	columns     []DatabaseColumn
}

func (s *DatabaseRecordService) resolveDatabase(canonicalID string) (*databaseTarget, error) {
	if strings.TrimSpace(canonicalID) == "" {
		return nil, twirp.RequiredArgumentError("database_id")
	}
	module, instance, err := resolveInstance(s.modules, s.instances, canonicalID)
	if err != nil {
		return nil, err
	}
	if canonicalKindOf(module, instance) != DatabaseKind {
		return nil, twirp.InvalidArgumentError("database_id", fmt.Sprintf("%q is not a database", canonicalID))
	}
	// The stored columns passed validation when written, so failing to read
	// them is corruption, not the caller's mistake.
	columns, err := parseDatabaseColumns(instance.Settings, s.limits)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("read columns of %s: %w", canonicalID, err))
	}
	return &databaseTarget{instance: instance, canonicalID: canonicalID, columns: columns}, nil
}

// lockDatabase reads a resolved database's columns again inside a write
// transaction and locks its instance row until the transaction ends. A
// settings write that deletes a column strips the column's values in its own
// transaction; checking a row's values against columns read before the lock
// could keep a value for a column just deleted, which a later column with the
// same id would then show.
func (s *DatabaseRecordService) lockDatabase(ctx context.Context, tx *gorm.DB, target *databaseTarget) (*databaseTarget, error) {
	instance, err := s.instances.WithTx(tx).GetByIDForUpdate(ctx, target.instance.ID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, twirp.NotFoundError(fmt.Sprintf("instance %q not found", target.canonicalID))
	}
	if err != nil {
		return nil, fmt.Errorf("lock database %s: %w", target.canonicalID, err)
	}
	columns, err := parseDatabaseColumns(instance.Settings, s.limits)
	if err != nil {
		return nil, fmt.Errorf("read columns of %s: %w", target.canonicalID, err)
	}
	return &databaseTarget{instance: instance, canonicalID: target.canonicalID, columns: columns}, nil
}

// recordWriteError passes on a Twirp error a write transaction refused with,
// such as a value that does not fit its column, and reports anything else as
// internal.
func recordWriteError(doing string, err error) error {
	var refused twirp.Error
	if errors.As(err, &refused) {
		return refused
	}
	return twirp.InternalErrorWith(fmt.Errorf("%s: %w", doing, err))
}

// requestValues decodes and checks the values of a write, given as the
// request's typed JSON or text values.
func requestValues(target *databaseTarget, typedJSON *string, text *client.DatabaseTextValues) (map[string]any, error) {
	switch {
	case typedJSON != nil:
		raw, err := decodeTypedValues(*typedJSON)
		if err != nil {
			return nil, err
		}
		return coerceValues(target.columns, raw, databaseValuesTyped)
	case text != nil:
		raw := make(map[string]any, len(text.Values))
		for id, value := range text.Values {
			raw[id] = value
		}
		return coerceValues(target.columns, raw, databaseValuesText)
	default:
		return nil, twirp.RequiredArgumentError("values")
	}
}

func (s *DatabaseRecordService) CreateDatabaseRecord(ctx context.Context, req *client.CreateDatabaseRecordRequest) (*client.CreateDatabaseRecordResponse, error) {
	target, err := s.resolveDatabase(req.DatabaseId)
	if err != nil {
		return nil, err
	}
	return s.createRecord(ctx, target, req)
}

// createRecord writes a row into a resolved database, checking its values
// against the columns as they are inside the writing transaction.
func (s *DatabaseRecordService) createRecord(ctx context.Context, target *databaseTarget, req *client.CreateDatabaseRecordRequest) (*client.CreateDatabaseRecordResponse, error) {
	if req.InsertKey != nil {
		if err := checkInsertKey(*req.InsertKey); err != nil {
			return nil, err
		}
	}
	typedJSON, text := createValues(req)

	outcome := client.CreateDatabaseRecordOutcome_CREATE_DATABASE_RECORD_OUTCOME_CREATED
	var record *models.DatabaseRecord
	err := s.records.Transaction(ctx, func(tx *gorm.DB) error {
		locked, err := s.lockDatabase(ctx, tx, target)
		if err != nil {
			return err
		}
		values, err := requestValues(locked, typedJSON, text)
		if err != nil {
			return err
		}
		for id, value := range values {
			if value == nil {
				delete(values, id)
			}
		}
		records := s.records.WithTx(tx)
		if req.InsertKey != nil {
			existing, err := records.FindByInsertKey(ctx, target.instance.ID, *req.InsertKey)
			if err == nil {
				outcome, record = client.CreateDatabaseRecordOutcome_CREATE_DATABASE_RECORD_OUTCOME_DUPLICATE, existing
				return nil
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
		}
		// Counted under the database's lock (see lockDatabase), so racing
		// inserts cannot pass the cap.
		count, err := records.Count(ctx, target.instance.ID)
		if err != nil {
			return err
		}
		if count >= s.limits.MaxRecords {
			outcome = client.CreateDatabaseRecordOutcome_CREATE_DATABASE_RECORD_OUTCOME_FULL
			return nil
		}
		inserted, created, err := records.Insert(ctx, target.instance.ID, values, req.InsertKey)
		if err != nil {
			return err
		}
		record = inserted
		if !created {
			outcome = client.CreateDatabaseRecordOutcome_CREATE_DATABASE_RECORD_OUTCOME_DUPLICATE
			return nil
		}
		return s.publishChange(tx, locked, record, databaseRecordCreated)
	})
	if err != nil {
		return nil, recordWriteError(fmt.Sprintf("create record in %s", target.canonicalID), err)
	}
	response := &client.CreateDatabaseRecordResponse{Status: okStatus("Record created"), Outcome: outcome}
	if record != nil {
		response.Record, err = recordToProto(target.canonicalID, record, nil)
		if err != nil {
			return nil, err
		}
	}
	return response, nil
}

func createValues(req *client.CreateDatabaseRecordRequest) (*string, *client.DatabaseTextValues) {
	switch values := req.Values.(type) {
	case *client.CreateDatabaseRecordRequest_TypedValuesJson:
		return &values.TypedValuesJson, nil
	case *client.CreateDatabaseRecordRequest_TextValues:
		return nil, values.TextValues
	}
	return nil, nil
}

func updateValues(req *client.UpdateDatabaseRecordRequest) (*string, *client.DatabaseTextValues) {
	switch values := req.Values.(type) {
	case *client.UpdateDatabaseRecordRequest_TypedValuesJson:
		return &values.TypedValuesJson, nil
	case *client.UpdateDatabaseRecordRequest_TextValues:
		return nil, values.TextValues
	}
	return nil, nil
}

func checkInsertKey(key string) error {
	if key == "" || strings.ContainsRune(key, 0) || utf8.RuneCountInString(key) > maxDatabaseInsertKeyLength {
		return twirp.InvalidArgumentError("insert_key", fmt.Sprintf("must be 1 to %d characters with no NUL", maxDatabaseInsertKeyLength))
	}
	return nil
}

func (s *DatabaseRecordService) UpdateDatabaseRecord(ctx context.Context, req *client.UpdateDatabaseRecordRequest) (*client.UpdateDatabaseRecordResponse, error) {
	target, err := s.resolveDatabase(req.DatabaseId)
	if err != nil {
		return nil, err
	}
	return s.updateRecord(ctx, target, req)
}

// updateRecord changes a row of a resolved database, checking its values
// against the columns as they are inside the writing transaction.
func (s *DatabaseRecordService) updateRecord(ctx context.Context, target *databaseTarget, req *client.UpdateDatabaseRecordRequest) (*client.UpdateDatabaseRecordResponse, error) {
	recordID, err := parseRecordID(req.RecordId)
	if err != nil {
		return nil, err
	}
	typedJSON, text := updateValues(req)

	var record *models.DatabaseRecord
	err = s.records.Transaction(ctx, func(tx *gorm.DB) error {
		locked, err := s.lockDatabase(ctx, tx, target)
		if err != nil {
			return err
		}
		patch, err := requestValues(locked, typedJSON, text)
		if err != nil {
			return err
		}
		updated, err := s.records.WithTx(tx).Update(ctx, target.instance.ID, recordID, patch, req.ExpectedRevision)
		if err != nil {
			return err
		}
		record = updated
		return s.publishChange(tx, locked, record, databaseRecordUpdated)
	})
	var refused twirp.Error
	switch {
	case errors.As(err, &refused):
		return nil, refused
	case errors.Is(err, gorm.ErrRecordNotFound):
		return &client.UpdateDatabaseRecordResponse{Status: okStatus("No such record"), Updated: false}, nil
	case errors.Is(err, repo.ErrDatabaseRecordRevisionConflict):
		return nil, twirp.NewError(twirp.Aborted, "the record changed since it was read")
	case err != nil:
		return nil, recordWriteError(fmt.Sprintf("update record %s in %s", recordID, target.canonicalID), err)
	}
	protoRecord, err := recordToProto(target.canonicalID, record, nil)
	if err != nil {
		return nil, err
	}
	return &client.UpdateDatabaseRecordResponse{Status: okStatus("Record updated"), Updated: true, Record: protoRecord}, nil
}

func (s *DatabaseRecordService) DeleteDatabaseRecord(ctx context.Context, req *client.DeleteDatabaseRecordRequest) (*client.DeleteDatabaseRecordResponse, error) {
	target, err := s.resolveDatabase(req.DatabaseId)
	if err != nil {
		return nil, err
	}
	recordID, err := parseRecordID(req.RecordId)
	if err != nil {
		return nil, err
	}
	err = s.records.Transaction(ctx, func(tx *gorm.DB) error {
		deleted, err := s.records.WithTx(tx).Delete(ctx, target.instance.ID, recordID)
		if err != nil {
			return err
		}
		// The deletion is newer than the record's last change, so readers
		// ordering by revision drop a late update behind it.
		deleted.Revision++
		return s.publishChange(tx, target, deleted, databaseRecordDeleted)
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &client.DeleteDatabaseRecordResponse{Status: okStatus("No such record"), Deleted: false}, nil
	}
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("delete record %s in %s: %w", recordID, target.canonicalID, err))
	}
	return &client.DeleteDatabaseRecordResponse{Status: okStatus("Record deleted"), Deleted: true}, nil
}

func (s *DatabaseRecordService) GetDatabaseRecord(ctx context.Context, req *client.GetDatabaseRecordRequest) (*client.GetDatabaseRecordResponse, error) {
	target, err := s.resolveDatabase(req.DatabaseId)
	if err != nil {
		return nil, err
	}
	recordID, err := parseRecordID(req.RecordId)
	if err != nil {
		return nil, err
	}
	record, err := s.records.Get(ctx, target.instance.ID, recordID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &client.GetDatabaseRecordResponse{Status: okStatus("No such record"), Found: false}, nil
	}
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("get record %s in %s: %w", recordID, target.canonicalID, err))
	}
	protoRecord, err := recordToProto(target.canonicalID, record, nil)
	if err != nil {
		return nil, err
	}
	return &client.GetDatabaseRecordResponse{Status: okStatus("Record found"), Found: true, Record: protoRecord}, nil
}

func (s *DatabaseRecordService) ListDatabaseRecords(ctx context.Context, req *client.ListDatabaseRecordsRequest) (*client.ListDatabaseRecordsResponse, error) {
	target, err := s.resolveDatabase(req.DatabaseId)
	if err != nil {
		return nil, err
	}
	if err := s.checkPage(req.Offset, req.Limit); err != nil {
		return nil, err
	}
	if _, ok := findColumn(target.columns, req.SortBy); req.SortBy != "" && !ok {
		return nil, twirp.InvalidArgumentError("sort_by", fmt.Sprintf("the database has no column %q", req.SortBy))
	}
	sort := repo.DatabaseRecordSort{ColumnID: req.SortBy, Descending: req.Descending}
	records, total, err := s.page(ctx, target, sort, req.Offset, req.Limit)
	if err != nil {
		return nil, err
	}
	out, err := recordsToProto(target.canonicalID, records, nil)
	if err != nil {
		return nil, err
	}
	return &client.ListDatabaseRecordsResponse{Status: okStatus(fmt.Sprintf("Found %d record(s)", len(out))), Records: out, Total: total}, nil
}

func (s *DatabaseRecordService) FindDatabaseRecord(ctx context.Context, req *client.FindDatabaseRecordRequest) (*client.FindDatabaseRecordResponse, error) {
	target, err := s.resolveDatabase(req.DatabaseId)
	if err != nil {
		return nil, err
	}
	if req.Match == "" {
		return nil, twirp.RequiredArgumentError("match")
	}
	var record *models.DatabaseRecord
	if req.ColumnId == "" {
		recordID, parseErr := uuid.Parse(strings.TrimSpace(req.Match))
		if parseErr != nil {
			return &client.FindDatabaseRecordResponse{Status: okStatus("No such record"), Found: false}, nil
		}
		record, err = s.records.Get(ctx, target.instance.ID, recordID)
	} else {
		column, ok := findColumn(target.columns, req.ColumnId)
		if !ok {
			return nil, twirp.InvalidArgumentError("column_id", fmt.Sprintf("the database has no column %q", req.ColumnId))
		}
		match, coerceErr := coerceTextCell(column, req.Match)
		if coerceErr != nil {
			return nil, coerceErr
		}
		record, err = s.records.FindFirstByColumnValue(ctx, target.instance.ID, column.ID, match)
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &client.FindDatabaseRecordResponse{Status: okStatus("No such record"), Found: false}, nil
	}
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("find record in %s: %w", target.canonicalID, err))
	}
	protoRecord, err := recordToProto(target.canonicalID, record, nil)
	if err != nil {
		return nil, err
	}
	return &client.FindDatabaseRecordResponse{Status: okStatus("Record found"), Found: true, Record: protoRecord}, nil
}

func (s *DatabaseRecordService) ListPublicDatabaseRecords(ctx context.Context, req *client.ListPublicDatabaseRecordsRequest) (*client.ListPublicDatabaseRecordsResponse, error) {
	target, err := s.resolveDatabase(req.DatabaseId)
	if err != nil {
		return nil, err
	}
	if err := s.checkPage(req.Offset, req.Limit); err != nil {
		return nil, err
	}
	public := publicColumns(target.columns)
	if len(public) == 0 {
		return &client.ListPublicDatabaseRecordsResponse{Status: okStatus("The database has no public column"), Records: []*client.DatabaseRecord{}, Total: 0}, nil
	}
	records, total, err := s.page(ctx, target, repo.DatabaseRecordSort{Descending: true}, req.Offset, req.Limit)
	if err != nil {
		return nil, err
	}
	out, err := recordsToProto(target.canonicalID, records, public)
	if err != nil {
		return nil, err
	}
	return &client.ListPublicDatabaseRecordsResponse{Status: okStatus(fmt.Sprintf("Found %d record(s)", len(out))), Records: out, Total: total}, nil
}

func (s *DatabaseRecordService) checkPage(offset, limit int32) error {
	if offset < 0 {
		return twirp.InvalidArgumentError("offset", "must not be negative")
	}
	if limit < 1 || int(limit) > s.limits.MaxPageSize {
		return twirp.InvalidArgumentError("limit", fmt.Sprintf("must be 1 to %d", s.limits.MaxPageSize))
	}
	return nil
}

func (s *DatabaseRecordService) page(ctx context.Context, target *databaseTarget, sort repo.DatabaseRecordSort, offset, limit int32) ([]*models.DatabaseRecord, int64, error) {
	records, err := s.records.List(ctx, target.instance.ID, sort, int(offset), int(limit))
	if err != nil {
		return nil, 0, twirp.InternalErrorWith(fmt.Errorf("list records of %s: %w", target.canonicalID, err))
	}
	total, err := s.records.Count(ctx, target.instance.ID)
	if err != nil {
		return nil, 0, twirp.InternalErrorWith(fmt.Errorf("count records of %s: %w", target.canonicalID, err))
	}
	return records, total, nil
}

// publishChange queues `database.record.changed` in the transaction that
// changed the record.
func (s *DatabaseRecordService) publishChange(tx *gorm.DB, target *databaseTarget, record *models.DatabaseRecord, op databaseRecordOp) error {
	event := databaseRecordChangedEvent{
		DatabaseID: target.canonicalID,
		RecordID:   record.ID.String(),
		Op:         op,
		Revision:   record.Revision,
		CreatedAt:  record.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
	if op != databaseRecordDeleted {
		values, err := repo.DecodeRecordValues(record.Values)
		if err != nil {
			return err
		}
		event.PublicValues = publicValues(target.columns, values)
	}
	return s.publisher.PublishEventIn(tx, string(cloudevents.SubjectDatabaseRecordChanged), record.ID.String(), nil, event)
}

func parseRecordID(raw string) (uuid.UUID, error) {
	if strings.TrimSpace(raw) == "" {
		return uuid.Nil, twirp.RequiredArgumentError("record_id")
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, twirp.InvalidArgumentError("record_id", "must be a record id")
	}
	return id, nil
}

func findColumn(columns []DatabaseColumn, id string) (DatabaseColumn, bool) {
	for _, column := range columns {
		if column.ID == id {
			return column, true
		}
	}
	return DatabaseColumn{}, false
}

func publicColumns(columns []DatabaseColumn) []DatabaseColumn {
	public := []DatabaseColumn{}
	for _, column := range columns {
		if column.Public {
			public = append(public, column)
		}
	}
	return public
}

func okStatus(message string) *client.ResponseStatus {
	return &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: message}
}

// recordToProto converts a stored record. With only set, its values keep just
// those columns.
func recordToProto(canonicalID string, record *models.DatabaseRecord, only []DatabaseColumn) (*client.DatabaseRecord, error) {
	valuesJSON := record.Values
	if only != nil {
		values, err := repo.DecodeRecordValues(record.Values)
		if err != nil {
			return nil, twirp.InternalErrorWith(err)
		}
		valuesJSON, err = encodeValues(publicValues(only, values))
		if err != nil {
			return nil, twirp.InternalErrorWith(err)
		}
	}
	return &client.DatabaseRecord{
		Id:         record.ID.String(),
		DatabaseId: canonicalID,
		Revision:   record.Revision,
		CreatedAt:  timestamppb.New(record.CreatedAt),
		UpdatedAt:  timestamppb.New(record.UpdatedAt),
		ValuesJson: valuesJSON,
	}, nil
}

func recordsToProto(canonicalID string, records []*models.DatabaseRecord, only []DatabaseColumn) ([]*client.DatabaseRecord, error) {
	out := make([]*client.DatabaseRecord, 0, len(records))
	for _, record := range records {
		converted, err := recordToProto(canonicalID, record, only)
		if err != nil {
			return nil, err
		}
		out = append(out, converted)
	}
	return out, nil
}
