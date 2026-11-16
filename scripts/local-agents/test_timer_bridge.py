import ast
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
import unittest

@dataclass
class FakeTask:
    id: str = ''
    default_timer: bool = False
    default_due: float | None = None
    delay: str = ''
    cwd: str = ''
    status: str = 'idle'

class TimerTests(unittest.TestCase):
    def setUp(self):
        source = ast.parse(Path(__file__).with_name('timer_bridge.py').read_text(encoding='utf-8'))
        node = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == 'handle')
        self.starts = []
        self.scheduler = SimpleNamespace(tasks=[], start=lambda task, **options: self.starts.append(options), save=lambda: None)
        scope = {'scheduler': self.scheduler, 'time': SimpleNamespace(time=lambda: 1000), 'parse_delay': lambda value: sum(int(part) * factor for part, factor in zip(value.split(':'), [3600, 60])), 'Task': FakeTask, 'Path': Path, 'asdict': __import__('dataclasses').asdict, 'default_delay': lambda due, now: '1:00', 'reset': None, 'reset_error': 'No reset'}
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<timer-handler>', 'exec'), scope)
        self.handle = scope['handle']

    def test_zero_delay_never_enqueues_an_immediate_send(self):
        with self.assertRaisesRegex(ValueError, 'future delay'):
            self.handle('timer', {'delay': '0:00'})
        self.assertEqual(self.scheduler.tasks, [])
        self.assertEqual(self.starts, [])

    def test_past_absolute_time_never_starts(self):
        with self.assertRaisesRegex(ValueError, 'future schedule'):
            self.handle('timer', {'due': 999})
        self.assertEqual(self.starts, [])

    def test_absolute_future_call_preserves_deadline(self):
        self.handle('timer', {'due': 8200, 'cwd': str(Path.cwd())})
        self.assertEqual(self.starts, [{'validate': False, 'deadline': 8200}])
        self.assertFalse(self.scheduler.tasks[0].default_timer)

if __name__ == '__main__':
    unittest.main()
