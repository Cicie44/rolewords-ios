import { ScrollView, StyleSheet, Text, View } from 'react-native';

export default function LearnScreen() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>学习 Learn</Text>

      <View style={styles.card}>
        <Text style={styles.word}>stakeholder</Text>
        <Text style={styles.meaning}>中文：利益相关者；项目相关方</Text>

        <Text style={styles.sectionLabel}>Example</Text>
        <Text style={styles.example}>
          We arranged a meeting with the key stakeholders to discuss the project risks.
        </Text>

        <Text style={styles.sectionLabel}>翻译</Text>
        <Text style={styles.translation}>
          我们与主要项目相关方安排了一次会议，讨论项目风险。
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    padding: 20,
    paddingTop: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 24,
  },
  card: {
    width: '100%',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    padding: 20,
    gap: 8,
  },
  word: {
    fontSize: 24,
    fontWeight: '700',
  },
  meaning: {
    fontSize: 16,
    color: '#333',
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888',
    marginTop: 8,
  },
  example: {
    fontSize: 15,
    lineHeight: 22,
  },
  translation: {
    fontSize: 15,
    lineHeight: 22,
    color: '#333',
  },
});
