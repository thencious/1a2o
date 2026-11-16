import unittest
from unittest.mock import patch, Mock
import launch_app


class StartupTests(unittest.TestCase):
    @patch.object(launch_app, "activate_app", return_value=False)
    @patch.object(launch_app, "open_app")
    @patch.object(launch_app, "start_services")
    @patch.object(launch_app, "application_ready", return_value=True)
    def test_ready_ui_opens_without_waiting_for_background_workers(self, ready, start, open_app, activate):
        launch_app.main([])
        start.assert_called_once_with(wait=False)
        open_app.assert_called_once_with([])

    @patch.object(launch_app, "activate_app", return_value=False)
    @patch.object(launch_app, "show_startup_window")
    @patch.object(launch_app, "open_app")
    @patch.object(launch_app, "start_services")
    @patch.object(launch_app, "application_ready", return_value=False)
    def test_cold_start_displays_window_before_waiting_for_services(self, ready, start, open_app, window, activate):
        order = []
        start.side_effect = lambda **kwargs: order.append(("start", kwargs["wait"]))
        open_app.side_effect = lambda arguments: order.append(("open", arguments))
        launch_app.main(["mailto:person@example.com"])
        start.assert_not_called()
        open_app.assert_not_called()
        begin, finish = window.call_args.args
        begin()
        finish()
        self.assertEqual(order, [("start", True), ("open", ["mailto:person@example.com"])])

    @patch.object(launch_app, "application_ready")
    @patch.object(launch_app, "show_startup_window")
    @patch.object(launch_app, "start_services")
    @patch.object(launch_app, "activate_app", return_value=True)
    def test_existing_window_is_focused_without_waiting_for_health_checks(self, activate, start, window, ready):
        self.assertTrue(launch_app.main([]))
        start.assert_called_once_with(wait=False)
        window.assert_not_called()
        ready.assert_not_called()

    @patch.object(launch_app, "activate_app", return_value=True)
    @patch.object(launch_app.subprocess, "run", return_value=Mock(returncode=0))
    def test_browser_handoff_does_not_wait_for_services_a_second_time(self, run, activate):
        launch_app.open_app(["mailto:person@example.com"])
        command = run.call_args.args[0]
        self.assertIn("--services-ready", command)
        self.assertIn("mailto:person@example.com", command)

    @patch.object(launch_app, "open_app")
    @patch.object(launch_app, "start_services")
    def test_background_startup_never_opens_a_window(self, start, open_app):
        launch_app.main(["--services-only"])
        start.assert_called_once_with(wait=True)
        open_app.assert_not_called()


if __name__ == "__main__":
    unittest.main()
