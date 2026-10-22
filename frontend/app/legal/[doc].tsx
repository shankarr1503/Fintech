import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { DOCUMENTS, UPDATED } from '../../src/legal/documents';
import { fill, Filled } from '../../src/legal/Filled';
import licenses from '../../src/legal/licenses.json';
import { Card, Empty, Label, Screen, Section, Small, Strong } from '../../src/ui/kit';
import { LegalFooter } from '../../src/ui/LegalFooter';
import { C, F, themed } from '../../src/ui/theme';

/** Fonts, icons and images bundled in the app, and their licences. */
const ASSETS: [string, string, string][] = [
  ['Pixelify Sans (font)', 'SIL Open Font License 1.1', 'Copyright 2021 The Pixelify Sans Project Authors. Modified: ₹ sign and arrows added'],
  ['Feather icons', 'MIT', 'Copyright (c) 2013-2017 Cole Bemis'],
  ['react-native-vector-icons', 'MIT', 'Copyright (c) 2015 Joel Arvidsson'],
  ['App icon, coin and illustrations', 'Proprietary', 'Drawn for CoinQuest; no third-party images are used'],
];

export default function LegalPage() {
  const { doc = '' } = useLocalSearchParams<{ doc: string }>();

  if (doc === 'licenses') {
    return (
      <Screen title="Licences" kicker="Legal">
        <Small style={{ marginTop: 6 }}>CoinQuest is built with open-source software. Thank you to everyone who made it.</Small>
        <Section title="Fonts, icons and images">
          <Card padded={false} style={{ paddingHorizontal: 16 }}>
            {ASSETS.map(([name, license, notice], i) => (
              <View key={name} style={[styles.item, i > 0 && styles.line]}>
                <Strong>{name}</Strong>
                <Small>{license} · {notice}</Small>
              </View>
            ))}
          </Card>
        </Section>
        <Section title={`Open-source packages (${licenses.length})`}>
          <Card padded={false} style={{ paddingHorizontal: 16 }}>
            {licenses.map((l, i) => (
              <View key={l.name} style={[styles.pkg, i > 0 && styles.line]}>
                <Small color={C.ink} style={{ flex: 1 }} numberOfLines={1}>{l.name}</Small>
                <Small>{l.license}</Small>
              </View>
            ))}
          </Card>
        </Section>
        <Small style={{ marginTop: 14 }}>Full licence texts ship with each package. The server’s Python packages are listed in docs/LICENSES.md.</Small>
        <LegalFooter />
      </Screen>
    );
  }

  const document = DOCUMENTS[doc];
  if (!document)
    return (
      <Screen title="Not found">
        <Empty icon="file-text" title="This page doesn’t exist" body="It may have moved. The links below go to all our policies." />
        <LegalFooter />
      </Screen>
    );

  return (
    <Screen title={document.title} kicker="Legal">
      <Filled text={document.summary} style={styles.lead} />
      <Label style={{ marginTop: 10 }}>Last updated {UPDATED}</Label>
      {document.sections.map((section) => (
        <View key={section.heading} style={{ marginTop: 26 }}>
          <Text style={styles.h2} accessibilityRole="header">
            {fill(section.heading)}
          </Text>
          {section.body.map((block, i) =>
            typeof block === 'string' ? (
              <Filled key={i} text={block} style={styles.p} />
            ) : (
              <View key={i} style={{ marginTop: 6 }}>
                {block.bullets.map((b) => (
                  <View key={b} style={styles.bullet}>
                    <Text style={styles.dot}>•</Text>
                    <Filled text={b} style={[styles.p, { flex: 1, marginTop: 0 }] as any} />
                  </View>
                ))}
              </View>
            ),
          )}
        </View>
      ))}
      <LegalFooter />
    </Screen>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    lead: { fontFamily: F.regular, fontSize: 17, lineHeight: 25, color: C.ink2, marginTop: 6 },
    h2: { fontFamily: F.semibold, fontSize: 19, lineHeight: 25, color: C.ink },
    p: { fontFamily: F.regular, fontSize: 15, lineHeight: 23, color: C.ink2, marginTop: 8, maxWidth: 680 },
    bullet: { flexDirection: 'row', marginTop: 6, maxWidth: 680 },
    dot: { width: 18, fontFamily: F.regular, fontSize: 15, lineHeight: 23, color: C.ink3 },
    item: { paddingVertical: 12, gap: 2 },
    pkg: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
    line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  }),
);
