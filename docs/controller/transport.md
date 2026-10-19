# Shared recorder controls

The shared control contract, commands, state and execution rules are documented
in [Recorder control API](../control-api.md).

The GUI calls `Api.control_command`; the MIDI adapter calls `ControlAPI.execute`.
Both use the same Transport instance. GUI operations wait for its action gate;
remote commands receive `busy` when another action owns it. Laptop Stop
opens Review. The controller's Record/Stop stops and keeps the active take.
