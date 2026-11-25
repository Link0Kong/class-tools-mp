const cloud = require('../../utils/cloud.js');

Component({
  properties: {
    query: { type: String, value: '' },
    scope: { type: String, value: 'all' },
    hasScope: { type: Boolean, value: false }
  },
  data: { scopes: ['全班', '班委', '团员'] },
  lifetimes: { detached() { this.invalidate(); } },
  methods: {
    invalidate() {
      this._revision = (this._revision || 0) + 1;
    },
    input(e) {
      const value = String(e.detail.value || '');
      this.invalidate();
      this.triggerEvent('querychange', { value: value, seats: [] });
    },
    async search(e) {
      const value = e.detail && typeof e.detail.value === 'string' ? e.detail.value : this.data.query;
      if (!value.trim()) return;
      this.invalidate();
      const revision = this._revision;
      this.triggerEvent('querychange', { value: value, seats: [] });
      const seats = await cloud.searchRosterSeats(value);
      if (seats.length && revision === this._revision && this.data.query === value) {
        this.triggerEvent('querychange', { value: value, seats: seats });
      }
    },
    clear() { this.input({ detail: { value: '' } }); },
    pickScope(e) {
      const scope = ['all', 'committee', 'league'][Number(e.detail.value)];
      if (scope) this.triggerEvent('scopechange', { value: scope });
    }
  }
});
