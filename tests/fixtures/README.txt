LR5 test fixtures

Adapted from tests/common.py in natekspencer/pylitterbot, commit
c9377089e5b74c023ac61552f420ba601be48702:
https://github.com/natekspencer/pylitterbot/blob/c9377089e5b74c023ac61552f420ba601be48702/tests/common.py

The LR5 and LR5 Pro payloads were converted to JSON. Robot names and unused
camera identifiers were replaced with test values. No credentials or payloads
from the user's Homey/Whisker account are included. These fixtures exercise
parsing; they do not establish successful operation against real LR5 Pro hardware.

The original MIT license is retained in PYLITTERBOT-LICENSE.
