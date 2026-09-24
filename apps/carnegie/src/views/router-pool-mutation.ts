type RouterPoolControlState = {
  poolMutationBusy: boolean;
  validatingImport: boolean;
  hasImportPreview: boolean;
  applyingImport: boolean;
};

export function routerPoolControlsLocked(state: RouterPoolControlState) {
  return state.poolMutationBusy || state.validatingImport || state.hasImportPreview || state.applyingImport;
}

export function createRouterPoolMutationGate() {
  let locked = false;

  return {
    get locked() {
      return locked;
    },
    async run(operation: () => Promise<unknown>): Promise<boolean> {
      if (locked) return false;
      locked = true;
      try {
        await operation();
        return true;
      } finally {
        locked = false;
      }
    },
  };
}
