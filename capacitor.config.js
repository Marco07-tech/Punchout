/** @type {import('@capacitor/cli').CapacitorConfig} */
const config = {
  appId: "com.punchout.app",
  appName: "Punchout",
  webDir: "www",
  server: {
    androidScheme: "https"
  },
  android: {
    backgroundColor: "#F2E8DA"
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0
    }
  }
};

module.exports = config;
