new Vue({
  el: '#vue',
  mixins: [windowMixin],
  data: function () {
    return {
      kycUserInfo: {
        id: '',
        username: '',
        name: '',
        email: '',
        status: '',
        picture: '',
        row: null
      },
      allowed_users: [],
      deAllowed_users: [],
      kycConfirmDialog: false,
      mobileSimple: false,

      accounts: [],
      accountsTable: {
        columns: [
          {
            name: 'username',
            align: 'left',
            label: '유저명',
            field: 'username',
            sortable: true
          },
          {
            name: 'verify',
            align: 'right',
            label: 'KYC 상태 ',
            field: 'verify',
            sortable: true
          }
        ],
        loading: false
      },
      settings: {},
      logs: [],
      serverlogEnabled: false,
      lnbits_theme_options: [
        'classic',
        'bitcoin',
        'flamingo',
        'cyber',
        'freedom',
        'mint',
        'autumn',
        'monochrome',
        'salvador'
      ],
      auditData: {},
      statusData: {},
      statusDataTable: {
        columns: [
          {
            name: 'date',
            align: 'left',
            label: this.$t('date'),
            field: 'date'
          },
          {
            name: 'message',
            align: 'left',
            label: this.$t('memo'),
            field: 'message'
          }
        ]
      },
      formData: {},
      formAddAdmin: '',
      formAddUser: '',
      formAddExtensionsManifest: '',
      formAllowedIPs: '',
      formBlockedIPs: '',
      isSuperUser: false,
      wallet: {},
      cancel: {},
      topUpDialog: {
        show: false
      },
      tab: 'funding',
      needsRestart: false
    }
  },
  created() {
    this.getSettings()
    this.getAudit()
    this.balance = +'{{ balance|safe }}'
    this.fetchAccounts()
  },
  computed: {
    lnbitsVersion() {
      return LNBITS_VERSION
    },
    checkChanges() {
      return !_.isEqual(this.settings, this.formData)
    },
    updateAvailable() {
      return LNBITS_VERSION !== this.statusData.version
    },
    formattedBalance: function () {
      if (LNBITS_DENOMINATION != 'sats') {
        return this.balance / 100
      } else {
        return LNbits.utils.formatSat(this.balance || this.g.wallet.sat)
      }
    },
    formattedFiatBalance() {
      if (this.fiatBalance) {
        return LNbits.utils.formatCurrency(
          this.fiatBalance.toFixed(2),
          this.g.wallet.currency
        )
      }
    },
    paymentsOmitter() {
      if (this.$q.screen.lt.md && this.mobileSimple) {
        return this.payments.length > 0 ? [this.payments[0]] : []
      }
      return this.payments
    },
    accountsOmitter() {
      // if (this.$q.screen.lt.md && this.mobileSimple) {
      //   return this.accounts.length > 0 ? [this.accounts[0]] : []
      // }
      return this.accounts
    },
    canPay: function () {
      if (!this.parse.invoice) return false
      return this.parse.invoice.sat <= this.balance
    },
    pendingPaymentsExist: function () {
      return this.payments.findIndex(payment => payment.pending) !== -1
    }
  },
  methods: {
    // KYC정보 - 인증 dialog
    verifyUser: function (row) {
      if (row.status === 'verified') {
        this.$q.notify({
          type: 'warning',
          message: '이미 KYC 인증완료된 사용자입니다.',
          icon: null
        })
      } else if (row.status === 'required') {
        this.$q.notify({
          type: 'warning',
          message: '아직 KYC 인증 신청을 하지 않은 사용자 입니다'
        })
      } else {
        this.kycConfirmDialog = true
        this.kycUserInfo.id = row.id
        this.kycUserInfo.username = row.username
        this.kycUserInfo.name = row.name
        this.kycUserInfo.email = row.email
        this.kycUserInfo.status = row.status
        this.kycUserInfo.picture = row.picture
        this.kycUserInfo.row = row
      }
    },
    // KYC Formdata - KYC 사용자 추가
    addKycUser() {
      if (this.kycUserInfo.row.status === 'requested') {
        const allowed_users = this.formData.lnbits_allowed_users
        if (!allowed_users.includes(this.kycUserInfo.id)) {
          this.formData.lnbits_allowed_users = [
            ...allowed_users,
            this.kycUserInfo.id
          ]
        }
        this.kycUserInfo.row.status = 'verified'
        this.$q.notify({
          type: 'positive',
          message: `${this.kycUserInfo.username}님의 KYC 인증이 완료되었습니다.`,
          icon: null
        })
      }
    },
    // KYC정보 - 인증취소
    removeKycUser(row) {
      if (row.status === 'verified') {
        const allowed_users = this.formData.lnbits_allowed_users
        if (allowed_users.includes(row.id)) {
          LNbits.utils
            .confirmDialog('해당 유저의 KYC 인증을 취소하시겠습니까?')
            .onOk(() => {
              // 1. formdata 에서 삭제
              this.formData.lnbits_allowed_users = allowed_users.filter(
                u => u !== row.id
              )
              // 2. deAllowed_users 에 추가
              this.deAllowed_users.push(row.id)
              // 3. row status 변경
              row.status = 'required'
              this.$q.notify({
                type: 'success',
                message: '해당 유저의 KYC 인증이 취소되었습니다.'
              })
            })
        }

        //fromdata 에서 삭제
        this.removeKycUser(row.id)
      }
    },

    // KYC정보 - 최종저장
    updateKycUserStatus: async function () {
      const allowed_users = this.formData.lnbits_allowed_users
      const deAllowed_users = this.deAllowed_users

      // allows_users - kyc status update (true)
      for (let i = 0; i < allowed_users.length; i++) {
        const user_id = allowed_users[i]
        await LNbits.api
          .request(
            'PUT',
            '/admin/api/v1/kyc/' +
              this.g.user.wallets[0].adminkey +
              '?user_id=' +
              user_id +
              '&verified=true'
          )
          .then(response => {})
          .catch(err => {
            LNbits.utils.notifyApiError(err)
          })
      }

      // deAllowed_users - kyc status update (false)
      for (let i = 0; i < deAllowed_users.length; i++) {
        const user_id = deAllowed_users[i]
        await LNbits.api
          .request(
            'PUT',
            '/admin/api/v1/kyc/' +
              this.g.user.wallets[0].adminkey +
              '?user_id=' +
              user_id +
              '&verified=false'
          )
          .then(response => {})
          .catch(err => {
            LNbits.utils.notifyApiError(err)
          })
      }
      this.fetchAccounts()
    },

    // Account(KYC 포함) 조회
    fetchAccounts: function () {
      return LNbits.api
        .getAccounts()
        .then(response => {
          this.accountsTable.loading = false
          // this.accountsTable.pagination.rowsNumber = response.data.total
          const accountsArr = []
          this.accounts = response.data.map(obj => {
            if (obj.config) {
              const email = obj.email
              const status = obj.config.kyc_status
              const picture = obj.config.picture
              let kycName = ''
              if (obj.config.first_name || obj.config.last_name) {
                kycName = obj.config.first_name + ' ' + obj.config.last_name
              }

              const row = {
                id: obj.id,
                username: obj.username,
                status: status,
                email: email,
                picture: picture,
                name: kycName
              }
              accountsArr.push(row)
            }
          })
          this.accounts = accountsArr
        })
        .catch(err => {
          this.accountsTable.loading = false
          LNbits.utils.notifyApiError(err)
        })
    },
    accountsTableRowKey: function (row) {
      return row.id
    },
    showChart: function () {
      this.paymentsChart.show = true
      LNbits.api
        .request(
          'GET',
          '/api/v1/payments/history?group=' + this.paymentsChart.group.value,
          this.g.wallet.adminkey
        )
        .then(response => {
          this.$nextTick(() => {
            if (this.paymentsChart.instance) {
              this.paymentsChart.instance.destroy()
            }
            this.paymentsChart.instance = generateChart(
              this.$refs.canvas,
              response.data
            )
          })
        })
        .catch(err => {
          LNbits.utils.notifyApiError(err)
          this.paymentsChart.show = false
        })
    },
    addAdminUser() {
      let addUser = this.formAddAdmin
      let admin_users = this.formData.lnbits_admin_users
      if (addUser && addUser.length && !admin_users.includes(addUser)) {
        //admin_users = [...admin_users, addUser]
        this.formData.lnbits_admin_users = [...admin_users, addUser]
        this.formAddAdmin = ''
      }
    },
    removeAdminUser(user) {
      let admin_users = this.formData.lnbits_admin_users
      this.formData.lnbits_admin_users = admin_users.filter(u => u !== user)
    },
    addAllowedUser() {
      let addUser = this.formAddUser
      let allowed_users = this.formData.lnbits_allowed_users
      if (addUser && addUser.length && !allowed_users.includes(addUser)) {
        this.formData.lnbits_allowed_users = [...allowed_users, addUser]
        this.formAddUser = ''
      }
    },
    removeAllowedUser(user) {
      let allowed_users = this.formData.lnbits_allowed_users
      this.formData.lnbits_allowed_users = allowed_users.filter(u => u !== user)
    },
    addExtensionsManifest() {
      const addManifest = this.formAddExtensionsManifest.trim()
      const manifests = this.formData.lnbits_extensions_manifests
      if (
        addManifest &&
        addManifest.length &&
        !manifests.includes(addManifest)
      ) {
        this.formData.lnbits_extensions_manifests = [...manifests, addManifest]
        this.formAddExtensionsManifest = ''
      }
    },
    removeExtensionsManifest(manifest) {
      const manifests = this.formData.lnbits_extensions_manifests
      this.formData.lnbits_extensions_manifests = manifests.filter(
        m => m !== manifest
      )
    },
    async toggleServerLog() {
      this.serverlogEnabled = !this.serverlogEnabled
      if (this.serverlogEnabled) {
        const wsProto = location.protocol !== 'http:' ? 'wss://' : 'ws://'
        const digestHex = await LNbits.utils.digestMessage(this.g.user.id)
        const localUrl =
          wsProto +
          document.domain +
          ':' +
          location.port +
          '/api/v1/ws/' +
          digestHex
        this.ws = new WebSocket(localUrl)
        this.ws.addEventListener('message', async ({data}) => {
          this.logs.push(data.toString())
          const scrollArea = this.$refs.logScroll
          if (scrollArea) {
            const scrollTarget = scrollArea.getScrollTarget()
            const duration = 0
            scrollArea.setScrollPosition(scrollTarget.scrollHeight, duration)
          }
        })
      } else {
        this.ws.close()
      }
    },
    addAllowedIPs() {
      const allowedIPs = this.formAllowedIPs.trim()
      const allowed_ips = this.formData.lnbits_allowed_ips
      if (
        allowedIPs &&
        allowedIPs.length &&
        !allowed_ips.includes(allowedIPs)
      ) {
        this.formData.lnbits_allowed_ips = [...allowed_ips, allowedIPs]
        this.formAllowedIPs = ''
      }
    },
    removeAllowedIPs(allowed_ip) {
      const allowed_ips = this.formData.lnbits_allowed_ips
      this.formData.lnbits_allowed_ips = allowed_ips.filter(
        a => a !== allowed_ip
      )
    },
    addBlockedIPs() {
      const blockedIPs = this.formBlockedIPs.trim()
      const blocked_ips = this.formData.lnbits_blocked_ips
      if (
        blockedIPs &&
        blockedIPs.length &&
        !blocked_ips.includes(blockedIPs)
      ) {
        this.formData.lnbits_blocked_ips = [...blocked_ips, blockedIPs]
        this.formBlockedIPs = ''
      }
    },
    removeBlockedIPs(blocked_ip) {
      const blocked_ips = this.formData.lnbits_blocked_ips
      this.formData.lnbits_blocked_ips = blocked_ips.filter(
        b => b !== blocked_ip
      )
    },
    restartServer() {
      LNbits.api
        .request('GET', '/admin/api/v1/restart/')
        .then(response => {
          this.$q.notify({
            type: 'positive',
            message: 'Success! Restarted Server',
            icon: null
          })
          this.needsRestart = false
        })
        .catch(function (error) {
          LNbits.utils.notifyApiError(error)
        })
    },
    topupWallet() {
      LNbits.api
        .request(
          'PUT',
          '/admin/api/v1/topup/',
          this.g.user.wallets[0].adminkey,
          this.wallet
        )
        .then(response => {
          this.$q.notify({
            type: 'positive',
            message:
              'Success! Added ' + this.wallet.amount + ' to ' + this.wallet.id,
            icon: null
          })
          this.wallet = {}
        })
        .catch(function (error) {
          LNbits.utils.notifyApiError(error)
        })
    },
    formatDate(date) {
      return moment(date * 1000).fromNow()
    },
    getNotifications() {
      if (this.settings.lnbits_notifications) {
        axios
          .get(this.settings.lnbits_status_manifest)
          .then(response => {
            this.statusData = response.data
          })
          .catch(error => {
            this.formData.lnbits_notifications = false
            error.response.data = {}
            error.response.data.message = 'Could not fetch status manifest.'
            LNbits.utils.notifyApiError(error)
          })
      }
    },
    getAudit() {
      LNbits.api
        .request('GET', '/admin/api/v1/audit/', this.g.user.wallets[0].adminkey)
        .then(response => {
          this.auditData = response.data
        })
        .catch(function (error) {
          LNbits.utils.notifyApiError(error)
        })
    },
    getSettings() {
      LNbits.api
        .request(
          'GET',
          '/admin/api/v1/settings/',
          this.g.user.wallets[0].adminkey
        )
        .then(response => {
          this.isSuperUser = response.data.is_super_user || false
          this.settings = response.data
          this.formData = {...this.settings}
          this.getNotifications()
        })
        .catch(function (error) {
          LNbits.utils.notifyApiError(error)
        })
    },
    updateSettings() {
      let data = _.omit(this.formData, [
        'is_super_user',
        'lnbits_allowed_funding_sources'
      ])
      LNbits.api
        .request(
          'PUT',
          '/admin/api/v1/settings/',
          this.g.user.wallets[0].adminkey,
          data
        )
        .then(response => {
          this.needsRestart =
            this.settings.lnbits_backend_wallet_class !==
              this.formData.lnbits_backend_wallet_class ||
            this.settings.lnbits_killswitch !== this.formData.lnbits_killswitch
          this.settings = this.formData
          this.formData = _.clone(this.settings)
          this.$q.notify({
            type: 'positive',
            message: `Success! Settings changed! ${
              this.needsRestart ? 'Restart required!' : ''
            }`,
            icon: null
          })
          // KYC user status update
          this.updateKycUserStatus()
        })
        .catch(function (error) {
          LNbits.utils.notifyApiError(error)
        })
    },
    deleteSettings() {
      LNbits.utils
        .confirmDialog('Are you sure you want to restore settings to default?')
        .onOk(() => {
          LNbits.api
            .request('DELETE', '/admin/api/v1/settings/')
            .then(response => {
              this.$q.notify({
                type: 'positive',
                message:
                  'Success! Restored settings to defaults, restart required!',
                icon: null
              })
              this.needsRestart = true
            })
            .catch(function (error) {
              LNbits.utils.notifyApiError(error)
            })
        })
    },
    downloadBackup() {
      window.open('/admin/api/v1/backup/', '_blank')
    }
  }
})
