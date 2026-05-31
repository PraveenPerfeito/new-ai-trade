"""
Operational controls unit tests.

Verifies that scanner, Telegram, and emergency stop switches are correctly
enforced across all entry points. These tests exist specifically because
the root-cause incident proved the scheduler toggle was written but never read.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_flags(**kwargs):
    defaults = dict(
        emergency_stop=False,
        maintenance_mode=False,
        telegram=True,
        ai_validation=True,
        futures_intelligence=True,
        anomaly_detection=True,
        paper_trading_monitor=True,
        backtest=True,
        daily_analytics_snapshot=True,
        rate_limiting=True,
    )
    defaults.update(kwargs)
    obj = MagicMock()
    for k, v in defaults.items():
        setattr(obj, k, v)
    return obj


def _make_tg_settings(alerts_enabled: bool = True):
    obj = MagicMock()
    obj.alerts_enabled = alerts_enabled
    return obj


# ── Unit Tests: FeatureFlags model ────────────────────────────────────────────

class TestFeatureFlagsModel:
    """New emergency_stop and maintenance_mode fields must exist with correct defaults."""

    def test_emergency_stop_defaults_false(self):
        from backend.system_settings.groups import FeatureFlags
        assert FeatureFlags().emergency_stop is False

    def test_maintenance_mode_defaults_false(self):
        from backend.system_settings.groups import FeatureFlags
        assert FeatureFlags().maintenance_mode is False

    def test_can_activate_emergency_stop(self):
        from backend.system_settings.groups import FeatureFlags
        assert FeatureFlags(emergency_stop=True).emergency_stop is True

    def test_can_activate_maintenance_mode(self):
        from backend.system_settings.groups import FeatureFlags
        assert FeatureFlags(maintenance_mode=True).maintenance_mode is True


# ── Unit Tests: _check_operational_flags helper ───────────────────────────────

class TestCheckOperationalFlags:
    """_check_operational_flags returns the correct block reason or None."""

    def test_returns_none_when_all_clear(self):
        import backend.workers.scan_task as st
        flags = _make_flags(emergency_stop=False, maintenance_mode=False)
        svc = MagicMock()
        # asyncio.run() is used inside; patch it to return flags directly
        with patch.object(st, "_check_operational_flags", wraps=st._check_operational_flags):
            with patch("asyncio.run", return_value=flags):
                with patch("backend.system_settings.service.get_settings_service"):
                    with patch("backend.system_settings.groups.FeatureFlags"):
                        result = st._check_operational_flags()
        assert result is None

    def test_returns_emergency_stop_when_active(self):
        import backend.workers.scan_task as st
        flags = _make_flags(emergency_stop=True)
        with patch("asyncio.run", return_value=flags):
            with patch("backend.system_settings.service.get_settings_service"):
                with patch("backend.system_settings.groups.FeatureFlags"):
                    result = st._check_operational_flags()
        assert result == "emergency_stop"

    def test_returns_maintenance_mode_when_active(self):
        import backend.workers.scan_task as st
        flags = _make_flags(emergency_stop=False, maintenance_mode=True)
        with patch("asyncio.run", return_value=flags):
            with patch("backend.system_settings.service.get_settings_service"):
                with patch("backend.system_settings.groups.FeatureFlags"):
                    result = st._check_operational_flags()
        assert result == "maintenance_mode"


# ── Unit Tests: scan_task operational gate ────────────────────────────────────

class TestScanTaskOperationalGate:
    """run_scheduled_scan must honour the scheduler enable flag and operational flags."""

    @staticmethod
    def _call_task(mode: str = "standard") -> dict:
        import backend.workers.scan_task as st
        return st.run_scheduled_scan.run(mode=mode)

    def test_scheduler_disabled_skips_before_lock(self):
        """When coordinator.is_enabled() is False the lock is never acquired."""
        import backend.workers.scan_task as st
        coord = MagicMock()
        coord.is_enabled.return_value = False

        with patch.object(st, "SchedulerCoordinator", return_value=coord), \
             patch.object(st, "_check_operational_flags", return_value=None):
            result = self._call_task()

        assert result["skipped"] is True
        assert result["reason"] == "scheduler_disabled"
        coord.acquire_scan_lock.assert_not_called()

    def test_emergency_stop_blocks_scan(self):
        """emergency_stop flag blocks scan even when scheduler is enabled."""
        import backend.workers.scan_task as st
        coord = MagicMock()
        coord.is_enabled.return_value = True

        with patch.object(st, "SchedulerCoordinator", return_value=coord), \
             patch.object(st, "_check_operational_flags", return_value="emergency_stop"):
            result = self._call_task()

        assert result["skipped"] is True
        assert result["reason"] == "emergency_stop"
        coord.acquire_scan_lock.assert_not_called()

    def test_maintenance_mode_blocks_scan(self):
        """maintenance_mode flag blocks scan even when scheduler is enabled."""
        import backend.workers.scan_task as st
        coord = MagicMock()
        coord.is_enabled.return_value = True

        with patch.object(st, "SchedulerCoordinator", return_value=coord), \
             patch.object(st, "_check_operational_flags", return_value="maintenance_mode"):
            result = self._call_task()

        assert result["skipped"] is True
        assert result["reason"] == "maintenance_mode"

    def test_lock_held_skips_scan(self):
        """When another worker holds the lock, task returns lock_held."""
        import backend.workers.scan_task as st
        coord = MagicMock()
        coord.is_enabled.return_value = True
        coord.acquire_scan_lock.return_value = False

        with patch.object(st, "SchedulerCoordinator", return_value=coord), \
             patch.object(st, "_check_operational_flags", return_value=None):
            result = self._call_task()

        assert result["skipped"] is True
        assert result["reason"] == "lock_held"


# ── Unit Tests: scanner API trigger endpoint ──────────────────────────────────

class TestScannerTriggerOperationalGate:
    """POST /api/scanner/trigger must honour the scheduler toggle and emergency stop."""

    @pytest.mark.asyncio
    async def test_trigger_blocked_when_scheduler_disabled(self):
        from fastapi import HTTPException
        from backend.api.scanner import trigger_scan, TriggerRequest

        coord = MagicMock()
        coord.is_enabled.return_value = False

        with patch("backend.api.scanner.SchedulerCoordinator", return_value=coord):
            with pytest.raises(HTTPException) as exc_info:
                await trigger_scan(MagicMock(), TriggerRequest(mode="spot"))

        assert exc_info.value.status_code == 503
        assert "disabled" in exc_info.value.detail.lower()

    @pytest.mark.asyncio
    async def test_trigger_blocked_when_emergency_stop(self):
        from fastapi import HTTPException
        from backend.api.scanner import trigger_scan, TriggerRequest

        coord = MagicMock()
        coord.is_enabled.return_value = True
        flags = _make_flags(emergency_stop=True)
        svc = AsyncMock()
        svc.get_group = AsyncMock(return_value=flags)

        with patch("backend.api.scanner.SchedulerCoordinator", return_value=coord), \
             patch("backend.api.scanner.get_settings_service", return_value=svc), \
             patch("backend.api.scanner.FeatureFlags"):
            with pytest.raises(HTTPException) as exc_info:
                await trigger_scan(MagicMock(), TriggerRequest(mode="spot"))

        assert exc_info.value.status_code == 503
        assert "emergency" in exc_info.value.detail.lower()

    @pytest.mark.asyncio
    async def test_trigger_blocked_when_maintenance_mode(self):
        from fastapi import HTTPException
        from backend.api.scanner import trigger_scan, TriggerRequest

        coord = MagicMock()
        coord.is_enabled.return_value = True
        flags = _make_flags(maintenance_mode=True, emergency_stop=False)
        svc = AsyncMock()
        svc.get_group = AsyncMock(return_value=flags)

        with patch("backend.api.scanner.SchedulerCoordinator", return_value=coord), \
             patch("backend.api.scanner.get_settings_service", return_value=svc), \
             patch("backend.api.scanner.FeatureFlags"):
            with pytest.raises(HTTPException) as exc_info:
                await trigger_scan(MagicMock(), TriggerRequest(mode="spot"))

        assert exc_info.value.status_code == 503
        assert "maintenance" in exc_info.value.detail.lower()


# ── Unit Tests: telegram_notifier.send_signal_alert ──────────────────────────

class TestTelegramOperationalGate:
    """send_signal_alert must honour all Telegram and operational switches."""

    @pytest.mark.asyncio
    async def test_telegram_blocked_when_alerts_disabled(self):
        from backend.core.scanner.telegram_notifier import send_signal_alert

        tg = _make_tg_settings(alerts_enabled=False)
        flags = _make_flags(telegram=True, emergency_stop=False)
        svc = AsyncMock()
        svc.get_group = AsyncMock(side_effect=[tg, flags])

        with patch("backend.system_settings.service.get_settings_service", return_value=svc), \
             patch("backend.core.scanner.telegram_notifier._enqueue") as mock_enqueue:
            result = await send_signal_alert(MagicMock())

        assert result is False
        mock_enqueue.assert_not_called()

    @pytest.mark.asyncio
    async def test_telegram_blocked_when_feature_flag_off(self):
        from backend.core.scanner.telegram_notifier import send_signal_alert

        tg = _make_tg_settings(alerts_enabled=True)
        flags = _make_flags(telegram=False, emergency_stop=False)
        svc = AsyncMock()
        svc.get_group = AsyncMock(side_effect=[tg, flags])

        with patch("backend.system_settings.service.get_settings_service", return_value=svc), \
             patch("backend.core.scanner.telegram_notifier._enqueue") as mock_enqueue:
            result = await send_signal_alert(MagicMock())

        assert result is False
        mock_enqueue.assert_not_called()

    @pytest.mark.asyncio
    async def test_telegram_blocked_when_emergency_stop(self):
        from backend.core.scanner.telegram_notifier import send_signal_alert

        tg = _make_tg_settings(alerts_enabled=True)
        flags = _make_flags(telegram=True, emergency_stop=True)
        svc = AsyncMock()
        svc.get_group = AsyncMock(side_effect=[tg, flags])

        with patch("backend.system_settings.service.get_settings_service", return_value=svc), \
             patch("backend.core.scanner.telegram_notifier._enqueue") as mock_enqueue:
            result = await send_signal_alert(MagicMock())

        assert result is False
        mock_enqueue.assert_not_called()

    @pytest.mark.asyncio
    async def test_telegram_blocked_when_maintenance_mode(self):
        from backend.core.scanner.telegram_notifier import send_signal_alert

        tg = _make_tg_settings(alerts_enabled=True)
        flags = _make_flags(telegram=True, emergency_stop=False, maintenance_mode=True)
        svc = AsyncMock()
        svc.get_group = AsyncMock(side_effect=[tg, flags])

        with patch("backend.system_settings.service.get_settings_service", return_value=svc), \
             patch("backend.core.scanner.telegram_notifier._enqueue") as mock_enqueue:
            result = await send_signal_alert(MagicMock())

        assert result is False
        mock_enqueue.assert_not_called()


# ── Unit Tests: validation_source field ──────────────────────────────────────

class TestValidationSource:
    """AIValidationResult must carry validation_source on all paths."""

    def test_heuristic_result_has_heuristic_source(self):
        from backend.core.scanner.models import AIValidationResult
        result = AIValidationResult(
            confidence=80, validated=True, reasoning="heuristic",
            risks=[], strengths=[], validation_source="HEURISTIC",
        )
        assert result.validation_source == "HEURISTIC"

    def test_claude_result_has_claude_source(self):
        from backend.core.scanner.models import AIValidationResult
        result = AIValidationResult(
            confidence=88, validated=True, reasoning="claude approved",
            risks=[], strengths=[], validation_source="CLAUDE",
        )
        assert result.validation_source == "CLAUDE"

    def test_default_validation_source_is_heuristic(self):
        from backend.core.scanner.models import AIValidationResult
        result = AIValidationResult(
            confidence=75, validated=False, reasoning="test",
            risks=[], strengths=[],
        )
        assert result.validation_source == "HEURISTIC"

    def test_signal_has_validation_source_field(self):
        from backend.core.scanner.models import Signal
        assert "validation_source" in Signal.model_fields
        assert Signal.model_fields["validation_source"].default is None
