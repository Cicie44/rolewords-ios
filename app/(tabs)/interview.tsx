import { StyleSheet, Text, View } from 'react-native';

export default function InterviewScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>面试 Interview</Text>
      <Text style={styles.placeholder}>面试准备功能即将上线</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  placeholder: {
    fontSize: 15,
    color: '#888',
  },
});
