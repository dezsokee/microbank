{{- define "transaction-service.fullname" -}}
{{- printf "%s-transaction-service" .Release.Name -}}
{{- end -}}

{{- define "transaction-service.labels" -}}
app.kubernetes.io/name: transaction-service
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: microbank
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "transaction-service.selectorLabels" -}}
app.kubernetes.io/name: transaction-service
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
