// Treat the build as a debug build so the helpers do not short-circuit.
jest.mock('./debugLog', () => ({
  __esModule: true,
  default: jest.fn(),
  DEBUG_ENABLED: true,
}));

const mockEruda = {
  init: jest.fn(),
  get: jest.fn(),
  destroy: jest.fn(),
};
jest.mock('eruda', () => ({ __esModule: true, default: mockEruda }));

const { showDebugConsole, hideDebugConsole } = require('./debugConsole');

describe('debugConsole (debug build)', () => {
  beforeEach(() => {
    mockEruda.init.mockClear();
    mockEruda.get.mockReset();
    mockEruda.destroy.mockClear();
  });

  it('initialises eruda on show', async () => {
    await showDebugConsole();
    expect(mockEruda.init).toHaveBeenCalled();
  });

  it('destroys eruda on hide when an instance is running', async () => {
    mockEruda.get.mockReturnValue({});
    await hideDebugConsole();
    expect(mockEruda.destroy).toHaveBeenCalled();
  });

  it('does not destroy when no instance is running', async () => {
    mockEruda.get.mockReturnValue(undefined);
    await hideDebugConsole();
    expect(mockEruda.destroy).not.toHaveBeenCalled();
  });
});
