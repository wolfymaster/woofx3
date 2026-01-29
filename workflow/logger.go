package main

import (
	"log/slog"
)

type SlogAdapter struct {
	logger *slog.Logger
}

func (s *SlogAdapter) Info(message string, args ...any) {
	s.logger.Info(message, args...)
}

func (s *SlogAdapter) Error(message string, args ...any) {
	s.logger.Error(message, args...)
}

func (s *SlogAdapter) Debug(message string, args ...any) {
	s.logger.Debug(message, args...)
}

func (s *SlogAdapter) Warn(message string, args ...any) {
	s.logger.Warn(message, args...)
}
