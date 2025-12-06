// ✅ src/LayoutStyles.js
const LayoutStyles = {
  colors: {
    maroon: "#800000",
    white: "#ffffff",
    lightGrey: "#f9f9f9",
    borderGrey: "#e5e5e5",
  },
  text: {
    heading: {
      color: "#800000",
      fontWeight: "bold",
      textTransform: "uppercase",
      fontSize: "22px",
      marginBottom: "10px",
    },
    subheading: {
      color: "#800000",
      fontWeight: "600",
      fontSize: "16px",
      marginBottom: "6px",
    },
    body: {
      color: "#222",
      fontSize: "14px",
      lineHeight: "1.6",
    },
  },
  box: {
    border: "1px solid #800000",
    borderRadius: "10px",
    background: "#fff",
    padding: "20px",
  },
  button: {
    primary: {
      background: "#800000",
      color: "#fff",
      border: "none",
      borderRadius: "6px",
      padding: "10px 20px",
      cursor: "pointer",
      transition: "0.3s",
    },
    secondary: {
      background: "#ddd",
      border: "none",
      borderRadius: "6px",
      padding: "10px 20px",
      cursor: "pointer",
    },
  },
};

export default LayoutStyles;
