new Vue({
  el: '#vue',
  mixins: [windowMixin],
  data: function () {
    return {
      user: null,
      hasUsername: false,
      showUserId: false,
      kycStatus: '',
      tab: 'user',
      passwordData: {
        show: false,
        oldPassword: null,
        newPassword: null,
        newPasswordRepeat: null
      }
    }
  },
  methods: {
    registerForKyc: async function () {
      const completedMessage = this.$t('kyc_request_completed')
      const requestMessage = this.$t('kyc_request_dialog')
      LNbits.utils.confirmDialog(requestMessage).onOk(async () => {
        try {
          const {data} = await LNbits.api.request(
            'PUT',
            '/api/v1/auth/kyc',
            null,
            {
              user_id: this.user.id,
              username: this.user.username,
              email: this.user.email,
              config: this.user.config
            }
          )
          this.kycStatus = data.config.kyc_status
          this.$q.notify({
            type: 'positive',
            message: completedMessage
          })
        } catch (e) {
          LNbits.utils.notifyApiError(e)
        }
      })
    },

    activeLanguage: function (lang) {
      return window.i18n.locale === lang
    },
    changeLanguage: function (newValue) {
      window.i18n.locale = newValue
      this.$q.localStorage.set('lnbits.lang', newValue)
    },
    toggleDarkMode: function () {
      this.$q.dark.toggle()
      this.$q.localStorage.set('lnbits.darkMode', this.$q.dark.isActive)
    },
    changeColor: function (newValue) {
      document.body.setAttribute('data-theme', newValue)
      this.$q.localStorage.set('lnbits.theme', newValue)
    },
    updateAccount: async function () {
      try {
        const {data} = await LNbits.api.request(
          'PUT',
          '/api/v1/auth/update',
          null,
          {
            user_id: this.user.id,
            username: this.user.username,
            email: this.user.email,
            config: this.user.config
          }
        )
        this.user = data
        this.$q.notify({
          type: 'positive',
          message: 'Account updated.'
        })
      } catch (e) {
        LNbits.utils.notifyApiError(e)
      }
    },
    updatePassword: async function () {
      try {
        const {data} = await LNbits.api.request(
          'PUT',
          '/api/v1/auth/password',
          null,
          {
            user_id: this.user.id,
            password_old: this.passwordData.oldPassword,
            password: this.passwordData.newPassword,
            password_repeat: this.passwordData.newPasswordRepeat
          }
        )
        this.user = data
        this.passwordData.show = false
        this.$q.notify({
          type: 'positive',
          message: 'Password updated.'
        })
      } catch (e) {
        LNbits.utils.notifyApiError(e)
      }
    },
    showChangePassword: function () {
      this.passwordData = {
        show: true,
        oldPassword: null,
        newPassword: null,
        newPasswordRepeat: null
      }
    }
  },
  created: async function () {
    try {
      const {data} = await LNbits.api.getAuthenticatedUser()
      this.user = data
      this.hasUsername = !!data.username
      this.kycStatus = data.config.kyc_status

      if (!this.user.config) this.user.config = {}
    } catch (e) {
      LNbits.utils.notifyApiError(e)
    }
  }
})
